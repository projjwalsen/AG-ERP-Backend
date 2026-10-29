import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";

(async () => {
    const compare = JSON.parse(fs.readFileSync(".tmp-unsec-compare.json", "utf8"));
    const canonIds = compare.map((r: any) => r.canonId).filter(Boolean);
    const orphans = await prisma.journal.findMany({
        where: {
            journalHead: { ledgerId: { in: canonIds } },
            OR: [
                { voucherId: null },
                { voucher: { entries: { none: {} } } }
            ]
        },
        select: { id: true, amount: true, direction: true, remarks: true, journalHead: { select: { ledgerId: true } } }
    });
    if (orphans.length) {
        await prisma.journal.deleteMany({ where: { id: { in: orphans.map(j => j.id) } } });
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
    const all = walk(report.tree || []);
    const pick = (p: string) => {
        const x = all.find(n => n.path === p);
        return x && {
            od: x.node.openingDebit, oc: x.node.openingCredit,
            pd: x.node.periodDebit, pc: x.node.periodCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit
        };
    };
    const pdf = {
        parent: { oc: 194220007.32, cc: 209169654.45 },
        dir: { oc: 23586838.62, cc: 21758069.62 },
        bank: { oc: 5669384.98, cc: 86783560.99 },
        other: { oc: 101146121.22, cc: 100628023.84 }
    };
    const diff = (a: any, want: { oc: number; cc: number }) => a && {
        dOc: Number((Number(a.oc || 0) - want.oc).toFixed(2)),
        dCc: Number((Number(a.cc || 0) - want.cc).toFixed(2)),
        dCd: Number(Number(a.cd || 0).toFixed(2)),
        ...a
    };
    console.log(JSON.stringify({
        deleted: orphans.length,
        sample: orphans.slice(0, 12),
        vsPdf: {
            parent: diff(pick("Loans (Liability) > Unsecured Loans"), pdf.parent),
            dir: diff(pick("Loans (Liability) > Unsecured Loans > Loan From Directors"), pdf.dir),
            bank: diff(pick("Loans (Liability) > Unsecured Loans > Unsecured from Bank"), pdf.bank),
            other: diff(pick("Loans (Liability) > Unsecured Loans > Unsecured from Other than Bank"), pdf.other)
        },
        hdfc: {
            c3288: pick("Loans (Liability) > Unsecured Loans > Unsecured from Bank > HDFC CORPORATE CARD - V2P 3288"),
            c3767: pick("Loans (Liability) > Unsecured Loans > Unsecured from Bank > HDFC CORPORATE CARD - V2P 3767"),
            c9607: pick("Loans (Liability) > Unsecured Loans > Unsecured from Bank > HDFC CORPORATE CARD -9607"),
            c4385: pick("Loans (Liability) > Unsecured Loans > HDFC CORPORATE CARD -4385")
        },
        guard: all.filter(x =>
            /Duties & Taxes$|Sundry Creditors$|Bank OD A\/c & CC A\/c$/.test(x.path)
        ).map(x => ({ path: x.path, cd: x.node.closingDebit, cc: x.node.closingCredit, oc: x.node.openingCredit, od: x.node.openingDebit })),
        leaves: all.filter(x => /Loans \(Liability\) > Unsecured/.test(x.path)).map(x => ({
            path: x.path,
            oc: x.node.openingCredit, od: x.node.openingDebit,
            pd: x.node.periodDebit, pc: x.node.periodCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
