import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";

const WAGES = "e31befe2-658a-41f7-a616-d2e6e0d1c07f";
const ANIL = "98808105-118b-4790-9395-3f1c1dea2593";
const PRAR = "e63e1ad7-d57c-4e6c-b9e9-ecfe9e449471";
const VANI = "8a72bc47-fa41-4feb-aa6d-ce8fb2c33857";

const HEADS = {
    [WAGES]: { head: "f5559e28-4d01-41e5-a1d1-a9dbaa49ef79", categoryId: "8a23cc9f-176d-4b5c-a42d-fdd161302023" },
    [ANIL]: { head: "03253551-bd54-415c-a4a2-66730610ff70", categoryId: "5682da78-d1b6-4663-be28-eae1f85cc5b3" },
    [PRAR]: { head: "30388f85-43e9-4917-a68f-aea103770641", categoryId: "c087dd1c-c7aa-458d-aa6a-d33095731f8b" },
    [VANI]: { head: "b6eda6cf-2de7-4cbe-88b2-0c2313d2afb0", categoryId: "a29c8182-01cb-40d4-bd95-aa941897efbd" }
};

const TARGET: Record<string, number> = {
    "Salary & Wages": 25339744,
    "Anil Menda Salary": 1800000,
    "Prarthana Anil Menda Salary": 1200000,
    "Vanishka Anil Menda Salary": 1200000
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
    const ebe = all.find(x => x.path === "Indirect Expenses > Employee Benefit Expenses")?.node;
    const listed = Object.keys(TARGET).map(name => {
        const row = all.find(x =>
            x.node.name.toLowerCase() === name.toLowerCase() &&
            /Employee Ben/i.test(x.path)
        );
        return row && {
            name,
            path: row.path,
            od: row.node.openingDebit, oc: row.node.openingCredit,
            cd: row.node.closingDebit, cc: row.node.closingCredit
        };
    });
    const siblings = (ebe?.children || []).map((c: any) => ({
        name: c.name, cd: c.closingDebit, cc: c.closingCredit
    }));
    const guardNames = [
        "Sundry Creditors",
        "Opening Stock",
        "Advance Salary",
        "Carriage Inward URD",
        "Carriage Inwards RD",
        "Current Assets",
        "Direct Expenses"
    ];
    const guard = guardNames.map(name => {
        const row = all.find(x => x.path === name || x.path.endsWith(" > " + name));
        return row && { name, path: row.path, cd: row.node.closingDebit, cc: row.node.closingCredit };
    });
    return { listed, siblings, guard, ebe: ebe && { cd: ebe.closingDebit, cc: ebe.closingCredit } };
};

async function postLine(opts: {
    voucherNo: string;
    date: Date;
    narr: string;
    ledgerId: string;
    side: "DEBIT" | "CREDIT";
    amount: number;
}) {
    const existing = await prisma.ledgerEntry.findFirst({
        where: {
            ledgerId: opts.ledgerId,
            entryType: opts.side,
            amount: opts.amount,
            voucher: {
                voucherNo: opts.voucherNo,
                branchId: BRANCH,
                narration: opts.narr,
                voucherType: "JOURNAL"
            }
        }
    });
    if (existing) return { skipped: true, voucherId: existing.voucherId };
    const meta = HEADS[opts.ledgerId];
    if (!meta) throw new Error(`No journal head for ${opts.ledgerId}`);
    const voucherId = randomUUID();
    await prisma.voucher.create({
        data: {
            id: voucherId,
            voucherNo: opts.voucherNo,
            voucherType: "JOURNAL",
            sourceId: randomUUID(),
            branchId: BRANCH,
            narration: opts.narr,
            voucherDate: opts.date,
            totalDebit: opts.side === "DEBIT" ? opts.amount : 0,
            totalCredit: opts.side === "CREDIT" ? opts.amount : 0,
            entries: {
                create: [{
                    id: randomUUID(),
                    ledgerId: opts.ledgerId,
                    branchId: BRANCH,
                    entryType: opts.side,
                    amount: opts.amount,
                    narration: opts.narr
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
            direction: opts.side === "DEBIT" ? "INWARD" : "OUTWARD",
            amount: opts.amount,
            status: "APPROVED",
            voucherId,
            voucherNo: opts.voucherNo,
            journalDate: opts.date,
            createdById: ACTOR,
            approvedById: ACTOR,
            approvedAt: new Date(),
            remarks: opts.narr,
            categoryId: meta.categoryId,
            importKey: `SALARY-PDF-RECON:${opts.voucherNo}:${opts.ledgerId}:${opts.side}:${opts.amount}`
        }
    });
    return { skipped: false, voucherId };
}

(async () => {
    const before = await snap();
    const posted = [
        await postLine({
            voucherNo: "17",
            date: new Date("2025-05-30T18:30:00.000Z"),
            narr: "BEING ANIL MENDA, PRARTHANA ANIL MENDA & VANISHKA ANIL MENDA SALARY PAYABLE MAY-25",
            ledgerId: WAGES, side: "CREDIT", amount: 350000
        }),
        await postLine({
            voucherNo: "38",
            date: new Date("2025-08-30T18:30:00.000Z"),
            narr: "BEING ANIL MENDA, PRARTHANA ANIL MENDA & VANISHKA ANIL MENDA SALARY PAYABLE AUGUST-25",
            ledgerId: VANI, side: "DEBIT", amount: 100000
        }),
        await postLine({
            voucherNo: "53",
            date: new Date("2025-12-30T18:30:00.000Z"),
            narr: "BEING ANIL MENDA, PRARTHANA ANIL MENDA & VANISHKA ANIL MENDA SALARY PAYABLE DECEMBER-25",
            ledgerId: ANIL, side: "DEBIT", amount: 150000
        }),
        await postLine({
            voucherNo: "71",
            date: new Date("2026-02-27T18:30:00.000Z"),
            narr: "BEING ANIL MENDA, PRARTHANA ANIL MENDA & VANISHKA ANIL MENDA SALARY PAYABLE FEBRUARY-26",
            ledgerId: PRAR, side: "DEBIT", amount: 100000
        })
    ];
    const after = await snap();
    const mismatches = after.listed.map((row: any) => ({
        name: row.name,
        ok: Number(row.cd) === TARGET[row.name] && Number(row.cc) === 0,
        tb: { cd: row.cd, cc: row.cc },
        tally: TARGET[row.name]
    }));
    const siblingChanged = before.siblings.filter((s: any) => {
        if (/Salary & Wages|Anil Menda|Prarthana|Vanishka/i.test(s.name)) return false;
        const n = after.siblings.find((x: any) => x.name === s.name);
        return !n || n.cd !== s.cd || n.cc !== s.cc;
    });
    const guardChanged = (before.guard || []).filter((g: any) => {
        const n = after.guard.find((x: any) => x && g && x.name === g.name);
        return n && (n.cd !== g.cd || n.cc !== g.cc);
    });
    console.log(JSON.stringify({
        posted,
        before: { listed: before.listed, ebe: before.ebe },
        after: { listed: after.listed, ebe: after.ebe },
        mismatches,
        siblingChanged,
        guardChanged
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
