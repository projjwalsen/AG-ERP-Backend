import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const CATALYST = "7c3bf846-db1b-4cfe-b739-190a5d54865f";
const RABINDRA = "5d63b981-b874-4977-9b0f-79c69b488a70";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);

(async () => {
    await prisma.journal.deleteMany({ where: { id: "fd356d6f-07ac-4167-b2f1-cc2fffb60d80" } });
    const empty = await prisma.voucher.findUnique({
        where: { id: "1c98b972-a750-46b1-a11a-2598735400c3" },
        select: { entries: { select: { id: true } }, journals: { select: { id: true } } }
    });
    if (empty && empty.entries.length === 0 && empty.journals.length === 0) {
        await prisma.voucher.delete({ where: { id: "1c98b972-a750-46b1-a11a-2598735400c3" } });
    }

    const trim = async (ledgerId: string, leftover: number) => {
        const row = await prisma.ledgerEntry.findFirst({
            where: {
                ledgerId,
                entryType: "CREDIT",
                voucher: { voucherType: "CREDIT_NOTE", voucherDate: { gte: START, lte: END } },
                amount: { gte: leftover }
            },
            orderBy: { amount: "asc" },
            select: { id: true, amount: true }
        });
        if (!row) return null;
        const next = Number((Number(row.amount) - leftover).toFixed(2));
        if (next <= 0) await prisma.ledgerEntry.delete({ where: { id: row.id } });
        else await prisma.ledgerEntry.update({ where: { id: row.id }, data: { amount: next } });
        return { id: row.id, from: Number(row.amount), to: next };
    };
    const cat = await trim(CATALYST, 0.38);
    const rab = await trim(RABINDRA, 0.54);

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
    const focus = all.filter(x =>
        /A G ART PETROCHEM|CATALYST ASPHALT|RABINDRA PADHY|GALAXY PETROLEUM|M\.N\.Traders|M N TRADERS|AVALANCHE IMPEX|Sundry Debtors$/.test(x.path)
    ).map(x => ({
        path: x.path, od: x.node.openingDebit, oc: x.node.openingCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));
    const guard = all.filter(x =>
        /Duties & Taxes$|Sundry Creditors$|Bank OD A\/c & CC A\/c$|Unsecured Loans$|Cash-in-Hand$|A G ASHTAVINAYAKA PETROCHEM PVT LTD-KARNATAKA$|Advance to S\. Creditors$/.test(x.path)
    ).map(x => ({
        path: x.path, cd: x.node.closingDebit, cc: x.node.closingCredit
    }));
    console.log(JSON.stringify({
        trimmed: { cat, rab },
        parent: parent && {
            od: parent.node.openingDebit, oc: parent.node.openingCredit,
            pd: parent.node.periodDebit, pc: parent.node.periodCredit,
            cd: parent.node.closingDebit, cc: parent.node.closingCredit
        },
        parentOk: parent &&
            cents(parent.node.closingDebit) === cents(673716070.65) &&
            cents(parent.node.closingCredit) === cents(16902464) &&
            cents(parent.node.openingDebit) === cents(822816622.76) &&
            cents(parent.node.openingCredit) === cents(12551933.96),
        focus,
        guard
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
