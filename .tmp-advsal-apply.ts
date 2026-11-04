import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";
import { VoucherType } from "@prisma/client";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const VOUCHER_ID = "e2490fb4-1566-49d0-8307-79f5c815ac7c";
const SALARY_LEDGER = "1b31070e-c9a2-4997-bda6-8613bbc8c5ce";
const AMOUNT = 659700;

const walk = (nodes: any[], path: string[] = []): any[] =>
    nodes.flatMap(node => {
        const next = [...path, node.name];
        return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
    });

const amounts = (n: any) => n && ({
    od: n.openingDebit, oc: n.openingCredit, cd: n.closingDebit, cc: n.closingCredit
});

const snap = async () => {
    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const all = walk(report.tree || []);
    const ca = all.find(x => x.path === "Current Assets")?.node;
    const loans = all.find(x => x.path === "Current Assets > Loans & Advances (Asset)")?.node;
    const salary = all.find(x => x.path === "Current Assets > Loans & Advances (Asset) > Advance Salary")?.node;
    const salaryLedger = all.find(x => x.path === "Current Assets > Loans & Advances (Asset) > Advance Salary > Advance Salary")?.node;
    return {
        ca: amounts(ca),
        loans: amounts(loans),
        salary: amounts(salary),
        salaryLedger: amounts(salaryLedger),
        caChildren: (ca?.children || []).map((c: any) => ({ name: c.name, ...amounts(c) })),
        loanChildren: (loans?.children || []).map((c: any) => ({ name: c.name, ...amounts(c) }))
    };
};

(async () => {
    const before = await snap();

    const voucher = await prisma.voucher.findUnique({
        where: { id: VOUCHER_ID },
        include: {
            entries: { include: { ledger: { select: { id: true, name: true } } } }
        }
    });
    if (!voucher) throw new Error("Voucher 57 not found");
    if (voucher.voucherNo !== "57") throw new Error(`Unexpected voucherNo ${voucher.voucherNo}`);
    if (voucher.voucherType !== VoucherType.JOURNAL) throw new Error(`Expected JOURNAL, got ${voucher.voucherType}`);
    if (voucher.entries.length !== 1) throw new Error(`Expected 1 entry, found ${voucher.entries.length}`);
    const entry = voucher.entries[0];
    if (entry.ledgerId !== SALARY_LEDGER) throw new Error(`Entry is on ${entry.ledger.name}`);
    if (entry.entryType !== "DEBIT") throw new Error(`Expected DEBIT, got ${entry.entryType}`);
    if (Number(entry.amount) !== AMOUNT) throw new Error(`Expected ${AMOUNT}, got ${entry.amount}`);

    await prisma.voucher.update({
        where: { id: VOUCHER_ID },
        data: { voucherType: VoucherType.OPENING_BALANCE }
    });

    const after = await snap();
    const changedCa = before.caChildren.filter((c: any) => {
        const n = after.caChildren.find((x: any) => x.name === c.name);
        return !n || n.od !== c.od || n.oc !== c.oc || n.cd !== c.cd || n.cc !== c.cc;
    });
    const changedLoans = before.loanChildren.filter((c: any) => {
        const n = after.loanChildren.find((x: any) => x.name === c.name);
        return !n || n.od !== c.od || n.oc !== c.oc || n.cd !== c.cd || n.cc !== c.cc;
    });

    console.log(JSON.stringify({
        voucher: { id: VOUCHER_ID, no: "57", from: "JOURNAL", to: "OPENING_BALANCE", amount: AMOUNT },
        before: { ca: before.ca, loans: before.loans, salary: before.salary, salaryLedger: before.salaryLedger },
        after: { ca: after.ca, loans: after.loans, salary: after.salary, salaryLedger: after.salaryLedger },
        target: {
            salary: { od: 659700, oc: 0, cd: 1381367, cc: 0 },
            ca: { od: 1308671312.36, oc: 99823985.94, cd: 1155862962.64, cc: 16902464 }
        },
        changedCaChildren: changedCa.map((c: any) => ({
            name: c.name, before: c, after: after.caChildren.find((x: any) => x.name === c.name)
        })),
        changedLoanChildren: changedLoans.map((c: any) => ({
            name: c.name, before: c, after: after.loanChildren.find((x: any) => x.name === c.name)
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
