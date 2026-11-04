import "dotenv/config";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const BOM_IDS = ["c1f62a06-f402-4b4c-a2b3-1dc3cb31c0b5", "8faa06f2-6b04-404e-8729-1cc3dd5d073b"];
const BOB_IDS = ["dc58112c-b8ea-4845-a598-c1cdffc44d6b", "9b5650be-5530-4401-8515-933dda455174"];
const CANON_BOM = "8faa06f2-6b04-404e-8729-1cc3dd5d073b";
const BANK_ACCOUNTS_ID = "7cf41220-8e89-4cd1-b6ce-e7bac996abd6";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const GAPS = [
    { no: "10672", side: "CREDIT", want: 140804, date: "2025-04-03" },
    { no: "10725", side: "CREDIT", want: 179301, date: "2025-04-04" },
    { no: "10726", side: "CREDIT", want: 179301, date: "2025-05-04" },
    { no: "10694", side: "CREDIT", want: 212426, date: "2025-05-05" },
    { no: "11308", side: "CREDIT", want: 186309, date: "2025-05-07" },
    { no: "10695", side: "CREDIT", want: 212426, date: "2025-06-05" },
    { no: "10729", side: "CREDIT", want: 179301, date: "2025-08-04" },
    { no: "12101", side: "DEBIT", want: 473.49, date: "2025-08-08" },
    { no: "10698", side: "CREDIT", want: 212426, date: "2025-09-05" },
    { no: "13947", side: "DEBIT", want: 3619533, date: "2025-10-31" },
    { no: "13972", side: "DEBIT", want: 3874719, date: "2025-11-03" },
    { no: "15557", side: "DEBIT", want: 19688725, date: "2026-01-02" },
    { no: "15612", side: "DEBIT", want: 20000000, date: "2026-01-09" },
    { no: "15720", side: "DEBIT", want: 19688724.75, date: "2026-01-28" },
    { no: "16645", side: "DEBIT", want: 19300000, date: "2026-02-06" },
    { no: "16708", side: "DEBIT", want: 7900000, date: "2026-02-11" },
    { no: "17232", side: "DEBIT", want: 11752682, date: "2026-03-13" },
    { no: "17242", side: "DEBIT", want: 1431495, date: "2026-03-13" },
    { no: "17243", side: "DEBIT", want: 1456454, date: "2026-03-13" },
    { no: "17864", side: "DEBIT", want: 15191737, date: "2026-03-27" },
    { no: "17982", side: "DEBIT", want: 1681771, date: "2026-03-31" }
];

(async () => {
    // Revert pass3 adds on colliding voucherNo "21"
    const v21 = await prisma.voucher.findMany({
        where: { branchId: BRANCH_ID, voucherNo: "21" },
        select: { id: true, voucherType: true, narration: true, entries: { select: { id: true, ledgerId: true, entryType: true, amount: true, narration: true } } }
    });
    const delete21 = v21.flatMap(v => v.entries.filter(e =>
        BOM_IDS.includes(e.ledgerId) &&
        (e.narration || "").startsWith("OD/CC recon")
    ));
    if (delete21.length) {
        await prisma.ledgerEntry.deleteMany({ where: { id: { in: delete21.map(e => e.id) } } });
        for (const v of v21) {
            const rest = v.entries.filter(e => !delete21.some(d => d.id === e.id));
            const dr = rest.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
            const cr = rest.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
            await prisma.voucher.update({ where: { id: v.id }, data: { totalDebit: money(dr), totalCredit: money(cr) } });
        }
    }

    // Fix 12101: receipt should debit BOM. Remove recon credit if present; add debit if needed; flip mobile if both sides expense.
    const v12101 = await prisma.voucher.findMany({
        where: { branchId: BRANCH_ID, voucherNo: "12101" },
        select: {
            id: true, voucherType: true, narration: true,
            entries: { select: { id: true, ledgerId: true, entryType: true, amount: true, narration: true, ledger: { select: { name: true } } } }
        }
    });

    const relink: any[] = [];
    const adds: any[] = [];
    const flips: any[] = [];
    const probes: any[] = [];

    for (const g of GAPS) {
        const vs = await prisma.voucher.findMany({
            where: { branchId: BRANCH_ID, voucherNo: String(g.no) },
            select: {
                id: true, voucherNo: true, voucherType: true, voucherDate: true, narration: true,
                entries: {
                    select: {
                        id: true, ledgerId: true, entryType: true, amount: true,
                        ledger: { select: { name: true, category: true, group: { select: { name: true } } } }
                    }
                }
            }
        });
        let have = 0;
        for (const v of vs) {
            for (const e of v.entries) {
                if (BOM_IDS.includes(e.ledgerId) && e.entryType === g.side) have += cents(e.amount);
            }
        }
        const need = cents(g.want) - have;
        const bankish = vs.flatMap(v => v.entries.filter(e =>
            !BOM_IDS.includes(e.ledgerId) &&
            e.entryType === g.side &&
            (e.ledgerId === BANK_ACCOUNTS_ID || e.ledger.category === "BANK" || norm(e.ledger.name) === "BANK ACCOUNTS" || norm(e.ledger.group?.name) === "BANK ACCOUNTS")
        ));
        probes.push({
            no: g.no, side: g.side, want: g.want, have: money(have), need: money(need),
            vouchers: vs.map(v => ({
                type: v.voucherType, date: localDate(v.voucherDate), narr: (v.narration || "").slice(0, 90),
                entries: v.entries.map(e => ({ side: e.entryType, amount: Number(e.amount), name: e.ledger.name, cat: e.ledger.category }))
            })),
            bankish: bankish.map(e => ({ id: e.id, amount: Number(e.amount), name: e.ledger.name }))
        });
        if (need <= 0) continue;
        // Relink bankish that fit
        let left = need;
        for (const e of bankish.sort((a, b) => cents(b.amount) - cents(a.amount))) {
            if (cents(e.amount) <= left) {
                relink.push({ entryId: e.id, to: CANON_BOM, no: g.no, amount: Number(e.amount) });
                left -= cents(e.amount);
            }
        }
        if (left <= 0) continue;

        // Search Bank Accounts by amount+date
        const dayStart = new Date(g.date + "T00:00:00.000+05:30");
        const dayEnd = new Date(g.date + "T23:59:59.999+05:30");
        const hits = await prisma.ledgerEntry.findMany({
            where: {
                entryType: g.side as any,
                amount: money(left),
                ledger: { OR: [{ id: BANK_ACCOUNTS_ID }, { name: { equals: "Bank Accounts", mode: "insensitive" } }] },
                voucher: { branchId: BRANCH_ID, voucherDate: { gte: dayStart, lte: dayEnd } }
            },
            select: { id: true, ledgerId: true, amount: true, voucher: { select: { voucherNo: true, voucherType: true } } },
            take: 3
        });
        if (hits[0] && !BOM_IDS.includes(hits[0].ledgerId)) {
            relink.push({ entryId: hits[0].id, to: CANON_BOM, no: g.no, amount: Number(hits[0].amount), foundNo: hits[0].voucher.voucherNo });
            left = 0;
            continue;
        }

        // Search any BANK ledger same day same amount
        const hits2 = await prisma.ledgerEntry.findMany({
            where: {
                entryType: g.side as any,
                amount: money(left),
                ledger: { category: "BANK" },
                voucher: { branchId: BRANCH_ID, voucherDate: { gte: dayStart, lte: dayEnd } }
            },
            select: { id: true, ledgerId: true, amount: true, ledger: { select: { name: true } }, voucher: { select: { voucherNo: true } } },
            take: 5
        });
        probes[probes.length - 1].amtHits = hits2.map(h => ({ id: h.id, no: h.voucher.voucherNo, name: h.ledger.name, amount: Number(h.amount) }));
        const steal2 = hits2.find(h => !BOM_IDS.includes(h.ledgerId) && !/YES BANK CA|BOM CA 60435349267|CENTRAL BANK|KARNATAKA CA|FD WITH/i.test(h.ledger.name));
        if (steal2) {
            relink.push({ entryId: steal2.id, to: CANON_BOM, no: g.no, amount: Number(steal2.amount), foundNo: steal2.voucher.voucherNo });
            left = 0;
        } else {
            probes[probes.length - 1].left = money(left);
        }
    }

    // 12101 special: excel receipt debit. If we posted a recon credit, delete it and add debit.
    for (const v of v12101) {
        const reconCr = v.entries.filter(e => BOM_IDS.includes(e.ledgerId) && (e.narration || "").startsWith("OD/CC recon") && e.entryType === "CREDIT");
        if (reconCr.length) {
            await prisma.ledgerEntry.deleteMany({ where: { id: { in: reconCr.map(e => e.id) } } });
        }
        const hasDr = v.entries.some(e => BOM_IDS.includes(e.ledgerId) && e.entryType === "DEBIT" && cents(e.amount) === 47349);
        if (!hasDr) {
            const mobile = v.entries.find(e => /MOBILE/i.test(e.ledger.name));
            if (mobile && mobile.entryType === "DEBIT") {
                flips.push({ id: mobile.id, to: "CREDIT" });
            }
            adds.push({
                id: randomUUID(),
                voucherId: v.id,
                ledgerId: CANON_BOM,
                branchId: BRANCH_ID,
                entryType: "DEBIT",
                amount: 473.49,
                narration: "OD/CC recon receipt 12101"
            });
        }
    }

    console.log(JSON.stringify({
        deleted21: delete21.length,
        relink: relink.length,
        adds: adds.length,
        flips: flips.length,
        probes: probes.map(p => ({
            no: p.no, side: p.side, want: p.want, have: p.have, need: p.need, left: p.left,
            bankish: p.bankish, amtHits: p.amtHits, nV: p.vouchers.length
        }))
    }, null, 2));

    if (relink.length) {
        const values = relink.map(r => `('${r.entryId}','${r.to}')`).join(",");
        await prisma.$executeRawUnsafe(
            `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
        );
    }
    for (const f of flips) {
        await prisma.ledgerEntry.update({ where: { id: f.id }, data: { entryType: f.to } });
    }
    if (adds.length) {
        await prisma.ledgerEntry.createMany({
            data: adds.map(a => ({
                id: a.id, voucherId: a.voucherId, ledgerId: a.ledgerId, branchId: a.branchId,
                entryType: a.entryType, amount: a.amount, narration: a.narration
            }))
        });
    }
    for (const v of v12101) {
        const entries = await prisma.ledgerEntry.findMany({ where: { voucherId: v.id } });
        const dr = entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const cr = entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        await prisma.voucher.update({ where: { id: v.id }, data: { totalDebit: money(dr), totalCredit: money(cr) } });
    }

    const after = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: BOM_IDS },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: { entryType: true, amount: true }
    });
    let dr = 0, cr = 0;
    for (const e of after) {
        if (e.entryType === "DEBIT") dr += cents(e.amount); else cr += cents(e.amount);
    }
    const bomXl = JSON.parse(fs.readFileSync(".tmp-odcc-bom.json", "utf8"));
    const bob = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: BOB_IDS }, voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } } },
        select: { entryType: true, amount: true }
    });
    let bobDr = 0, bobCr = 0;
    for (const e of bob) {
        if (e.entryType === "DEBIT") bobDr += cents(e.amount); else bobCr += cents(e.amount);
    }
    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH_ID, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const tb = walk(report.tree || []).filter(x => /Bank OD A\/c|60434886441|13780500000078/.test(x.path)).map(x => ({
        path: x.path,
        od: x.node.openingDebit, oc: x.node.openingCredit,
        pd: x.node.periodDebit, pc: x.node.periodCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));
    console.log("AFTER", JSON.stringify({
        bom: { dr: money(dr), cr: money(cr), excelDr: bomXl.perDr, excelCr: bomXl.perCr, dDr: money(dr - cents(bomXl.perDr)), dCr: money(cr - cents(bomXl.perCr)) },
        bob: { dr: money(bobDr), cr: money(bobCr) },
        tb
    }, null, 2));
    fs.writeFileSync(".tmp-odcc-pass4-probes.json", JSON.stringify(probes, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
