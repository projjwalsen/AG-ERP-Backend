import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";
import * as fs from "fs";

const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "")
    .replace(/\s*-\s*Sundry\s+(Debtor|Creditor)\s*$/i, "")
    .replace(/\s+/g, " ").trim().toUpperCase().replace(/[–—]/g, "-");

const ART = "0643bf95-4acb-4d80-adfd-9bea7f8bd47d";
const AVALANCHE = "90f5e440-7db2-4907-92d2-6b556f8b1244";
const CATALYST = "7c3bf846-db1b-4cfe-b739-190a5d54865f";
const RABINDRA = "5d63b981-b874-4977-9b0f-79c69b488a70";
const HEADING = "09615fc5-b7f6-49a1-9f1b-6efc5e8a3122";
const MN = "6df5d6c1-2894-4a38-9ded-9749283ca4f1";
const MN_DOT = "a9e539ad-24e3-433b-9182-60a5d2303168";
const GALAXY_OPEN = "f4f35315-cec5-4661-b3a5-e4dd55a0debd";
const GALAXY_MOVE = "67ac1a55-4e61-45cc-94af-72eea078a8b4";

async function refreshTotals(voucherIds: string[]) {
    for (const id of [...new Set(voucherIds.filter(Boolean))]) {
        const v = await prisma.voucher.findUnique({
            where: { id },
            select: { entries: { select: { entryType: true, amount: true } } }
        });
        if (!v) continue;
        const dr = v.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const cr = v.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        await prisma.voucher.update({
            where: { id },
            data: { totalDebit: money(dr), totalCredit: money(cr) }
        });
    }
}

(async () => {
    const stats = { deleted: 0, moved: 0, galaxyMoved: 0 };

    const artDup = await prisma.ledgerEntry.findMany({
        where: { ledgerId: ART, voucher: { voucherNo: "AG-ART-OPENING", voucherType: "JOURNAL" } },
        select: { id: true, voucherId: true }
    });
    const cnDebits = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: [AVALANCHE, CATALYST, RABINDRA] },
            entryType: "DEBIT",
            voucher: { voucherType: "CREDIT_NOTE", voucherDate: { gte: START, lte: END } }
        },
        select: { id: true, voucherId: true, ledgerId: true, amount: true }
    });
    const heading = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: HEADING,
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: { id: true, voucherId: true }
    });
    const deleteIds = [...artDup, ...cnDebits, ...heading];
    if (deleteIds.length) {
        await prisma.ledgerEntry.deleteMany({ where: { id: { in: deleteIds.map(e => e.id) } } });
        stats.deleted = deleteIds.length;
        await refreshTotals(deleteIds.map(e => e.voucherId));
    }

    const mnSale = await prisma.ledgerEntry.findMany({
        where: { ledgerId: MN, voucher: { voucherType: "SALE", voucherDate: { gte: START, lte: END } } },
        select: { id: true, voucherId: true, ledgerId: true }
    });
    const toMn = mnSale.filter(e => e.ledgerId !== MN_DOT);
    if (toMn.length) {
        await prisma.ledgerEntry.updateMany({
            where: { id: { in: toMn.map(e => e.id) } },
            data: { ledgerId: MN_DOT }
        });
        stats.moved = toMn.length;
    }

    const galaxyOpen = await prisma.ledgerEntry.findMany({
        where: { ledgerId: GALAXY_OPEN, voucher: { voucherType: "OPENING_BALANCE" } },
        select: { id: true }
    });
    if (galaxyOpen.length) {
        await prisma.ledgerEntry.updateMany({
            where: { id: { in: galaxyOpen.map(e => e.id) } },
            data: { ledgerId: GALAXY_MOVE }
        });
        stats.galaxyMoved = galaxyOpen.length;
    }
    const src = await prisma.ledger.findUnique({
        where: { id: GALAXY_OPEN },
        select: { openingDebit: true, openingCredit: true, openingBalance: true, openingBalanceDate: true }
    });
    const dst = await prisma.ledger.findUnique({
        where: { id: GALAXY_MOVE },
        select: { openingDebit: true, openingCredit: true, openingBalance: true }
    });
    if (src && Number(dst?.openingDebit || 0) === 0 && Number(src.openingDebit || 0) !== 0) {
        await prisma.ledger.update({
            where: { id: GALAXY_MOVE },
            data: {
                openingDebit: src.openingDebit,
                openingCredit: src.openingCredit,
                openingBalance: src.openingBalance,
                openingBalanceDate: src.openingBalanceDate
            }
        });
        await prisma.ledger.update({
            where: { id: GALAXY_OPEN },
            data: { openingDebit: 0, openingCredit: 0, openingBalance: 0, isActive: false }
        });
    } else if (src) {
        await prisma.ledger.update({ where: { id: GALAXY_OPEN }, data: { isActive: false } });
    }

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(report.tree || []);
    const parent = all.find(x => x.path === "Current Assets > Sundry Debtors");
    const children = all.filter(x => x.path.startsWith("Current Assets > Sundry Debtors > "));
    const targets = JSON.parse(fs.readFileSync(".tmp-sd-targets.json", "utf8")).leaves as any[];
    const pdfBy = new Map<string, any>();
    for (const t of targets) {
        const k = norm(t.name);
        const prev = pdfBy.get(k);
        if (!prev) pdfBy.set(k, { ...t });
        else { prev.od += t.od; prev.oc += t.oc; prev.cd += t.cd; prev.cc += t.cc; }
    }
    const tbBy = new Map<string, any>();
    for (const c of children) {
        const k = norm(c.node.name);
        const row = {
            name: c.node.name,
            od: Number(c.node.openingDebit || 0), oc: Number(c.node.openingCredit || 0),
            cd: Number(c.node.closingDebit || 0), cc: Number(c.node.closingCredit || 0)
        };
        const prev = tbBy.get(k);
        if (!prev) tbBy.set(k, row);
        else { prev.od += row.od; prev.oc += row.oc; prev.cd += row.cd; prev.cc += row.cc; prev.name += " | " + row.name; }
    }
    const mismatches = [...tbBy.entries()].map(([k, tb]) => {
        const pdf = pdfBy.get(k);
        if (!pdf) return { name: tb.name, issue: "extra", tb };
        if (cents(tb.od) !== cents(pdf.od) || cents(tb.oc) !== cents(pdf.oc) || cents(tb.cd) !== cents(pdf.cd) || cents(tb.cc) !== cents(pdf.cc)) {
            return { name: tb.name, pdf, tb, closeGap: money(cents(tb.cd) - cents(tb.cc) - (cents(pdf.cd) - cents(pdf.cc))) };
        }
        return null;
    }).filter(Boolean);
    const extras = [...tbBy.entries()].filter(([k]) => !pdfBy.has(k)).map(([, tb]) => tb);
    const guard = all.filter(x =>
        /Duties & Taxes$|Sundry Creditors$|Bank OD A\/c & CC A\/c$|Unsecured Loans$|Cash-in-Hand$|A G ASHTAVINAYAKA PETROCHEM PVT LTD-KARNATAKA$|Advance to S\. Creditors$/.test(x.path)
    ).map(x => ({
        path: x.path, od: x.node.openingDebit, oc: x.node.openingCredit, cd: x.node.closingDebit, cc: x.node.closingCredit
    }));

    console.log(JSON.stringify({
        stats,
        parent: parent && {
            od: parent.node.openingDebit, oc: parent.node.openingCredit,
            pd: parent.node.periodDebit, pc: parent.node.periodCredit,
            cd: parent.node.closingDebit, cc: parent.node.closingCredit
        },
        pdf: { od: 822816622.76, oc: 12551933.96, cd: 673716070.65, cc: 16902464 },
        parentOk: parent && cents(parent.node.closingDebit) === cents(673716070.65) && cents(parent.node.closingCredit) === cents(16902464),
        mismatchN: mismatches.length,
        mismatches,
        extras,
        guard
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
