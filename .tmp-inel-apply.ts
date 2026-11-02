import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const DATE = new Date("2026-03-30T18:30:00.000Z");
const VOUCHER_NO = "RECON-INEL-ITC-17-5";
const NARR = "Reclass Ineligible ITC 17(5) CGST/SGST/IGST to Tally closing";

const CGST = "790d2e2c-e33e-4dc5-af63-4eedf425cb7b";
const SGST = "04f3883d-ee82-4611-94d6-7bebd7daedd2";
const IGST = "5ae52a86-7117-4295-83aa-2d05e9b53486";

const HEADS: Record<string, { head: string; categoryId: string }> = {
    [CGST]: { head: "8da7c87b-c1b4-467b-8ca9-3eb6db721578", categoryId: "f613691b-93fa-4ee7-83d5-f37893d33d96" },
    [SGST]: { head: "e4611f5e-6877-4b66-a7ab-062c90a76905", categoryId: "ca3bf324-e25a-4dc7-9fbd-b2115ae91cae" },
    [IGST]: { head: "1bf8b0c0-1b7d-49c3-b4f7-660fb5fb83eb", categoryId: "46a5a781-0230-45f6-bb72-eb824acbcf07" }
};

const TARGET: Record<string, number> = {
    "Ineligible ITC 17(5) -CGST": 192508.71,
    "Ineligible ITC 17(5) -SGST": 192508.71,
    "Ineligible ITC 17(5) -IGST": 1450830.88
};

const walk = (nodes: any[], path: string[] = []): any[] =>
    nodes.flatMap(node => {
        const next = [...path, node.name];
        return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
    });

const snap = async () => {
    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const all = walk(report.tree || []);
    const rates = all.find(x => x.path === "Indirect Expenses > Rates and Taxes")?.node;
    const listed = Object.keys(TARGET).map(name => {
        const row = all.find(x => x.node.name.toLowerCase() === name.toLowerCase() && /Rates and Taxes/i.test(x.path));
        return row && {
            name, path: row.path,
            od: row.node.openingDebit, oc: row.node.openingCredit,
            cd: row.node.closingDebit, cc: row.node.closingCredit
        };
    });
    const siblings = (rates?.children || []).map((c: any) => ({ name: c.name, cd: c.closingDebit, cc: c.closingCredit }));
    const guardNames = [
        "Salary & Wages", "Anil Menda Salary", "Prarthana Anil Menda Salary", "Vanishka Anil Menda Salary",
        "Sundry Creditors", "Opening Stock", "Advance Salary", "Carriage Inward URD", "Carriage Inwards RD",
        "Current Assets", "Direct Expenses", "Employee Benefit Expenses"
    ];
    const guard = guardNames.map(name => {
        const row = all.find(x => x.path === name || x.path.endsWith(" > " + name));
        return row && { name, path: row.path, cd: row.node.closingDebit, cc: row.node.closingCredit };
    });
    return { listed, siblings, guard, rates: rates && { cd: rates.closingDebit, cc: rates.closingCredit } };
};

async function postLine(ledgerId: string, side: "DEBIT" | "CREDIT", amount: number) {
    const existing = await prisma.ledgerEntry.findFirst({
        where: {
            ledgerId, entryType: side, amount,
            voucher: { voucherNo: VOUCHER_NO, branchId: BRANCH, narration: NARR }
        }
    });
    if (existing) return { skipped: true, voucherId: existing.voucherId };
    const meta = HEADS[ledgerId];
    const voucherId = randomUUID();
    await prisma.voucher.create({
        data: {
            id: voucherId,
            voucherNo: VOUCHER_NO,
            voucherType: "JOURNAL",
            sourceId: randomUUID(),
            branchId: BRANCH,
            narration: NARR,
            voucherDate: DATE,
            totalDebit: side === "DEBIT" ? amount : 0,
            totalCredit: side === "CREDIT" ? amount : 0,
            entries: {
                create: [{
                    id: randomUUID(),
                    ledgerId,
                    branchId: BRANCH,
                    entryType: side,
                    amount,
                    narration: NARR
                }]
            }
        }
    });
    await prisma.journal.create({
        data: {
            id: randomUUID(),
            branchId: BRANCH,
            journalHeadId: meta.head,
            paymentMode: "OFFLINE",
            direction: side === "DEBIT" ? "INWARD" : "OUTWARD",
            amount,
            status: "APPROVED",
            voucherId,
            voucherNo: VOUCHER_NO,
            journalDate: DATE,
            createdById: ACTOR,
            approvedById: ACTOR,
            approvedAt: new Date(),
            remarks: NARR,
            categoryId: meta.categoryId,
            importKey: `INEL-ITC-RECON:${VOUCHER_NO}:${ledgerId}:${side}:${amount}`
        }
    });
    return { skipped: false, voucherId };
}

(async () => {
    const before = await snap();
    const posted = [
        await postLine(CGST, "CREDIT", 15830.71),
        await postLine(SGST, "DEBIT", 10460.21),
        await postLine(IGST, "DEBIT", 5370.50)
    ];
    const after = await snap();
    const mismatches = after.listed.map((row: any) => ({
        name: row.name,
        ok: Number(row.cd) === TARGET[row.name] && Number(row.cc) === 0,
        tb: { cd: row.cd, cc: row.cc },
        tally: TARGET[row.name]
    }));
    const siblingChanged = before.siblings.filter((s: any) => {
        if (/Ineligible ITC 17\(5\)/i.test(s.name)) return false;
        const n = after.siblings.find((x: any) => x.name === s.name);
        return !n || n.cd !== s.cd || n.cc !== s.cc;
    });
    const guardChanged = (before.guard || []).filter((g: any) => {
        const n = after.guard.find((x: any) => x && g && x.name === g.name);
        return n && (n.cd !== g.cd || n.cc !== g.cc);
    });
    console.log(JSON.stringify({
        posted,
        before: { listed: before.listed, rates: before.rates },
        after: { listed: after.listed, rates: after.rates },
        mismatches, siblingChanged, guardChanged
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
