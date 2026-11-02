import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(d);

(async () => {
    const ledgers = await prisma.ledger.findMany({
        where: {
            OR: [
                { name: { equals: "Advance Salary", mode: "insensitive" } },
                { code: { contains: "2f41f555ecfda07667764a6f", mode: "insensitive" } }
            ]
        },
        select: {
            id: true, name: true, code: true, isActive: true, category: true, branchId: true,
            openingDebit: true, openingCredit: true, openingBalance: true,
            group: { select: { name: true, code: true, parent: { select: { name: true } } } }
        }
    });

    const vouchers = await prisma.voucher.findMany({
        where: {
            voucherNo: "57",
            branchId: BRANCH
        },
        include: {
            entries: {
                include: {
                    ledger: { select: { id: true, name: true, code: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } } }
                }
            },
            journals: { select: { id: true, status: true, amount: true } }
        }
    });

    const salaryIds = ledgers.map(l => l.id);
    const salaryEntries = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: salaryIds } },
        include: {
            voucher: {
                select: {
                    id: true, voucherNo: true, voucherType: true, voucherDate: true, narration: true,
                    entries: {
                        select: {
                            id: true, entryType: true, amount: true,
                            ledger: { select: { name: true, category: true } }
                        }
                    }
                }
            }
        },
        orderBy: { createdAt: "asc" }
    });

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
    const ca = all.find(x => x.path === "Current Assets")?.node;
    const loans = all.find(x => x.path === "Current Assets > Loans & Advances (Asset)")?.node;
    const salary = all.filter(x => /Advance Salary/i.test(x.path));

    console.log(JSON.stringify({
        ledgers,
        voucher57: vouchers.map(v => ({
            id: v.id,
            no: v.voucherNo,
            type: v.voucherType,
            date: localDate(v.voucherDate),
            narr: v.narration,
            journals: v.journals,
            entries: v.entries.map(e => ({
                id: e.id,
                side: e.entryType,
                amt: Number(e.amount),
                narr: e.narration,
                ledger: e.ledger.name,
                code: e.ledger.code,
                cat: e.ledger.category,
                group: `${e.ledger.group?.parent?.name} > ${e.ledger.group?.name}`
            }))
        })),
        salaryEntries: salaryEntries.map(e => ({
            id: e.id,
            side: e.entryType,
            amt: Number(e.amount),
            narr: (e.narration || "").slice(0, 120),
            no: e.voucher.voucherNo,
            type: e.voucher.voucherType,
            date: localDate(e.voucher.voucherDate),
            others: e.voucher.entries.filter(x => x.id !== e.id).map(x => ({
                name: x.ledger.name, cat: x.ledger.category, side: x.entryType, amt: Number(x.amount)
            }))
        })),
        tb: {
            ca: ca && { od: ca.openingDebit, oc: ca.openingCredit, cd: ca.closingDebit, cc: ca.closingCredit },
            loans: loans && { od: loans.openingDebit, oc: loans.openingCredit, cd: loans.closingDebit, cc: loans.closingCredit },
            salary: salary.map(x => ({
                path: x.path,
                od: x.node.openingDebit, oc: x.node.openingCredit,
                cd: x.node.closingDebit, cc: x.node.closingCredit,
                pd: x.node.periodDebit, pc: x.node.periodCredit
            }))
        }
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
