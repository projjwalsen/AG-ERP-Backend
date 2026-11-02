import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";

const TARGET: Record<string, { cd: number; cc: number }> = {
    "Salary & Wages": { cd: 25339744, cc: 0 },
    "Anil Menda Salary": { cd: 1800000, cc: 0 },
    "Prarthana Anil Menda Salary": { cd: 1200000, cc: 0 },
    "Vanishka Anil Menda Salary": { cd: 1200000, cc: 0 },
    "Ineligible ITC 17(5) -CGST": { cd: 191593.46, cc: 0 },
    "Ineligible ITC 17(5) -SGST": { cd: 191593.46, cc: 0 },
    "Ineligible ITC 17(5) -IGST": { cd: 1450830.88, cc: 0 },
    "L&T Finance Holdings Limited. BL231224040100133": { cd: 0, cc: 3896 },
    "TDS RECEIVABLE ON UNSECURED LOAN-L & T FINANCE": { cd: 24090.33, cc: 0 },
    "CGST ITC Not Reflected in GSTR-2B": { cd: 27701.5, cc: 0 },
    "SGST ITC Not Reflected in GSTR-2B": { cd: 27701.5, cc: 0 }
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
    const listed = Object.keys(TARGET).map(name => {
        const hits = all.filter(x => x.node.name.toLowerCase() === name.toLowerCase() && (x.node.children || []).length === 0);
        const row = hits[0] || all.find(x => x.node.name.toLowerCase() === name.toLowerCase());
        return row && {
            name,
            path: row.path,
            od: row.node.openingDebit, oc: row.node.openingCredit,
            cd: row.node.closingDebit, cc: row.node.closingCredit
        };
    });
    const guard = ["Sundry Creditors", "Opening Stock", "Prepaid Exp", "Advance Salary", "Carriage Inward URD", "Carriage Inwards RD"]
        .map(name => {
            const row = all.find(x => x.path.endsWith(name) || x.node.name === name);
            return row && { name, path: row.path, cd: row.node.closingDebit, cc: row.node.closingCredit };
        });
    return { listed, guard };
};

async function ledgerByName(name: string) {
    const rows = await prisma.ledger.findMany({
        where: { name: { equals: name, mode: "insensitive" }, isActive: true, branchId: BRANCH },
        select: { id: true, name: true }
    });
    if (!rows.length) throw new Error(`Ledger not found: ${name}`);
    const withEntries = [];
    for (const r of rows) {
        const n = await prisma.ledgerEntry.count({ where: { ledgerId: r.id } });
        withEntries.push({ ...r, n });
    }
    withEntries.sort((a, b) => b.n - a.n);
    return withEntries[0];
}

async function headFor(ledgerId: string) {
    const head = await prisma.journalHead.findFirst({
        where: { ledgerId, isActive: true },
        orderBy: { createdAt: "asc" }
    });
    if (head) return head.id;
    const created = await prisma.journalHead.create({
        data: { id: randomUUID(), name: "Recon", ledgerId, isActive: true }
    });
    return created.id;
}

async function templateFor(ledgerId: string) {
    const j = await prisma.journal.findFirst({
        where: { journalHead: { ledgerId }, status: "APPROVED", branchId: BRANCH },
        select: { paymentMode: true, createdById: true, categoryId: true, direction: true }
    });
    return j || { paymentMode: "OFFLINE" as const, createdById: ACTOR, categoryId: null, direction: "OUTWARD" as const };
}

async function postLine(opts: {
    voucherNo: string;
    date: Date;
    narr: string;
    ledgerId: string;
    side: "DEBIT" | "CREDIT";
    amount: number;
    remarks: string;
}) {
    const existing = await prisma.ledgerEntry.findFirst({
        where: {
            ledgerId: opts.ledgerId,
            entryType: opts.side,
            amount: opts.amount,
            voucher: { voucherNo: opts.voucherNo, branchId: BRANCH, narration: opts.narr }
        }
    });
    if (existing) return { skipped: true, voucherId: existing.voucherId };
    const voucherId = randomUUID();
    const headId = await headFor(opts.ledgerId);
    const tmpl = await templateFor(opts.ledgerId);
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
            journalHeadId: headId,
            paymentMode: tmpl.paymentMode || "OFFLINE",
            direction: opts.side === "DEBIT" ? "INWARD" : "OUTWARD",
            amount: opts.amount,
            status: "APPROVED",
            voucherId,
            voucherNo: opts.voucherNo,
            journalDate: opts.date,
            createdById: tmpl.createdById || ACTOR,
            approvedById: ACTOR,
            approvedAt: new Date(),
            remarks: opts.remarks,
            categoryId: tmpl.categoryId,
            importKey: `LISTED-RECON:${opts.voucherNo}:${opts.ledgerId}:${opts.side}:${opts.amount}`
        }
    });
    return { skipped: false, voucherId };
}

(async () => {
    const before = await snap();

    const wages = await ledgerByName("Salary & Wages");
    const anil = await ledgerByName("Anil Menda Salary");
    const prar = await ledgerByName("Prarthana Anil Menda Salary");
    const vani = await ledgerByName("Vanishka Anil Menda Salary");
    const inelC = await ledgerByName("Ineligible ITC 17(5) -CGST");
    const inelS = await ledgerByName("Ineligible ITC 17(5) -SGST");
    const inelI = await ledgerByName("Ineligible ITC 17(5) -IGST");
    const cgstItc = await ledgerByName("CGST ITC Not Reflected in GSTR-2B");
    const sgstItc = await ledgerByName("SGST ITC Not Reflected in GSTR-2B");
    const tds = await ledgerByName("TDS RECEIVABLE ON UNSECURED LOAN-L & T FINANCE");
    const lt = await ledgerByName("L&T Finance Holdings Limited. BL231224040100133");

    const salary = [
        await postLine({
            voucherNo: "17",
            date: new Date("2025-05-30T18:30:00.000Z"),
            narr: "BEING ANIL MENDA, PRARTHANA ANIL MENDA & VANISHKA ANIL MENDA SALARY PAYABLE MAY-25",
            ledgerId: wages.id, side: "CREDIT", amount: 350000,
            remarks: "Listed recon Salary Journal 17 credit Salary & Wages"
        }),
        await postLine({
            voucherNo: "38",
            date: new Date("2025-08-30T18:30:00.000Z"),
            narr: "BEING ANIL MENDA, PRARTHANA ANIL MENDA & VANISHKA ANIL MENDA SALARY PAYABLE AUGUST-25",
            ledgerId: vani.id, side: "DEBIT", amount: 100000,
            remarks: "Listed recon Salary Journal 38 debit Vanishka"
        }),
        await postLine({
            voucherNo: "53",
            date: new Date("2025-12-30T18:30:00.000Z"),
            narr: "BEING ANIL MENDA, PRARTHANA ANIL MENDA & VANISHKA ANIL MENDA SALARY PAYABLE DECEMBER-25",
            ledgerId: anil.id, side: "DEBIT", amount: 150000,
            remarks: "Listed recon Salary Journal 53 debit Anil"
        }),
        await postLine({
            voucherNo: "71",
            date: new Date("2026-02-27T18:30:00.000Z"),
            narr: "BEING ANIL MENDA, PRARTHANA ANIL MENDA & VANISHKA ANIL MENDA SALARY PAYABLE FEBRUARY-26",
            ledgerId: prar.id, side: "DEBIT", amount: 100000,
            remarks: "Listed recon Salary Journal 71 debit Prarthana"
        })
    ];

    const inelLines = [
        { ledgerId: inelS.id, name: inelS.name, side: "DEBIT" as const, amount: 9544.96 },
        { ledgerId: inelI.id, name: inelI.name, side: "DEBIT" as const, amount: 5370.50 },
        { ledgerId: cgstItc.id, name: cgstItc.name, side: "DEBIT" as const, amount: 915.25 },
        { ledgerId: sgstItc.id, name: sgstItc.name, side: "DEBIT" as const, amount: 915.25 },
        { ledgerId: inelC.id, name: inelC.name, side: "CREDIT" as const, amount: 16745.96 }
    ];
    const inelDate = new Date("2026-03-31T18:29:59.000Z");
    const inelPosted = [];
    for (const line of inelLines) {
        inelPosted.push(await postLine({
            voucherNo: "RECON-INEL-ITC",
            date: inelDate,
            narr: `Reclass listed ineligible ITC / GSTR-2B to Excel Tally close: ${line.name}`,
            ledgerId: line.ledgerId,
            side: line.side,
            amount: line.amount,
            remarks: `Listed recon ${line.name}`
        }));
    }

    const tdsPosted = [
        await postLine({
            voucherNo: "RECON-TDS-LT",
            date: new Date("2026-03-31T18:29:59.000Z"),
            narr: "TDS receivable on unsecured loan L&T Finance to match Tally close",
            ledgerId: tds.id, side: "DEBIT", amount: 3896,
            remarks: "Listed recon TDS L&T"
        }),
        await postLine({
            voucherNo: "RECON-TDS-LT",
            date: new Date("2026-03-31T18:29:59.000Z"),
            narr: "TDS receivable on unsecured loan L&T Finance to match Tally close",
            ledgerId: lt.id, side: "CREDIT", amount: 3896,
            remarks: "Listed recon L&T Finance Holdings"
        })
    ];

    const after = await snap();
    const mismatches = after.listed.map((row: any) => {
        const t = TARGET[row.name];
        const ok = row && Number(row.cd) === t.cd && Number(row.cc) === t.cc;
        return { name: row.name, ok, tb: { cd: row.cd, cc: row.cc }, target: t };
    });
    const guardChanged = (before.guard || []).filter((g: any) => {
        const n = after.guard.find((x: any) => x && g && x.name === g.name);
        return n && (n.cd !== g.cd || n.cc !== g.cc);
    });

    console.log(JSON.stringify({
        ids: { wages, anil, prar, vani, inelC, inelS, inelI, cgstItc, sgstItc, tds, lt },
        salary, inelPosted, tdsPosted,
        before: before.listed,
        after: after.listed,
        mismatches,
        guardChanged
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
