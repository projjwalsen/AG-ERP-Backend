import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";

const ORIGINAL: Record<string, { cd: number; cc: number }> = {
    "Salary & Wages": { cd: 25689744, cc: 0 },
    "Anil Menda Salary": { cd: 1650000, cc: 0 },
    "Prarthana Anil Menda Salary": { cd: 1100000, cc: 0 },
    "Vanishka Anil Menda Salary": { cd: 1100000, cc: 0 },
    "Ineligible ITC 17(5) -CGST": { cd: 208339.42, cc: 0 },
    "Ineligible ITC 17(5) -SGST": { cd: 182048.5, cc: 0 },
    "Ineligible ITC 17(5) -IGST": { cd: 1445460.38, cc: 0 },
    "L&T Finance Holdings Limited. BL231224040100133": { cd: 0, cc: 0 },
    "TDS RECEIVABLE ON UNSECURED LOAN-L & T FINANCE": { cd: 20194.33, cc: 0 },
    "CGST ITC Not Reflected in GSTR-2B": { cd: 26786.25, cc: 0 },
    "SGST ITC Not Reflected in GSTR-2B": { cd: 26786.25, cc: 0 }
};

const walk = (nodes: any[], path: string[] = []): any[] =>
    nodes.flatMap(node => {
        const next = [...path, node.name];
        return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
    });

(async () => {
    const journals = await prisma.journal.findMany({
        where: { importKey: { startsWith: "LISTED-RECON:" } },
        select: {
            id: true, importKey: true, voucherId: true, journalHeadId: true,
            voucher: { select: { id: true, voucherNo: true, entries: { select: { id: true, ledger: { select: { name: true } } } } } }
        }
    });
    if (journals.length === 0) throw new Error("No LISTED-RECON journals found to undo");

    const voucherIds = [...new Set(journals.map(j => j.voucherId).filter((id): id is string => Boolean(id)))];
    const headIds = [...new Set(journals.map(j => j.journalHeadId))];

    const deleted = [];
    for (const j of journals) {
        deleted.push({
            journalId: j.id,
            importKey: j.importKey,
            voucherNo: j.voucher?.voucherNo,
            ledgers: j.voucher?.entries.map(e => e.ledger.name)
        });
        await prisma.journal.delete({ where: { id: j.id } });
    }
    for (const voucherId of voucherIds) {
        await prisma.ledgerEntry.deleteMany({ where: { voucherId } });
        await prisma.voucher.delete({ where: { id: voucherId } });
    }
    for (const headId of headIds) {
        const remaining = await prisma.journal.count({ where: { journalHeadId: headId } });
        const head = await prisma.journalHead.findUnique({ where: { id: headId }, select: { name: true } });
        if (remaining === 0 && head?.name === "Recon") {
            await prisma.journalHead.delete({ where: { id: headId } });
        }
    }

    const leftover = await prisma.journal.count({ where: { importKey: { startsWith: "LISTED-RECON:" } } });

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const all = walk(report.tree || []);
    const after = Object.keys(ORIGINAL).map(name => {
        const hits = all.filter(x => x.node.name.toLowerCase() === name.toLowerCase() && (x.node.children || []).length === 0);
        const row = hits[0] || all.find(x => x.node.name.toLowerCase() === name.toLowerCase());
        const t = ORIGINAL[name];
        return {
            name,
            path: row?.path,
            cd: row?.node.closingDebit,
            cc: row?.node.closingCredit,
            ok: row && Number(row.node.closingDebit) === t.cd && Number(row.node.closingCredit) === t.cc,
            target: t
        };
    });

    console.log(JSON.stringify({
        deletedJournals: deleted,
        voucherCount: voucherIds.length,
        leftover,
        after
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
