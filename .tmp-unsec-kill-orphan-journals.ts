import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();

(async () => {
    const extract = JSON.parse(fs.readFileSync(".tmp-unsec-excel.json", "utf8"));
    const compare = JSON.parse(fs.readFileSync(".tmp-unsec-compare.json", "utf8"));
    const names = extract.ledgers.map((l: any) => l.ledger);
    const canonIds = new Set(compare.map((r: any) => r.canonId));

    const copies = await prisma.ledger.findMany({
        where: {
            name: { in: names, mode: "insensitive" },
            category: "JOURNAL",
            id: { notIn: [...canonIds] }
        },
        select: {
            id: true, name: true,
            group: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } }
        }
    });
    const unsecCopies = copies.filter(c =>
        /Unsecured|Loan From Director|Loans \(Liability\)/i.test(
            `${c.group?.parent?.parent?.name || ""} ${c.group?.parent?.name || ""} ${c.group?.name}`
        )
    );
    const copyIds = unsecCopies.map(c => c.id);

    const orphanJournals = copyIds.length
        ? await prisma.journal.findMany({
            where: {
                journalHead: { ledgerId: { in: copyIds } },
                OR: [
                    { voucherId: null },
                    {
                        voucherId: { not: null },
                        voucher: { entries: { none: {} } }
                    }
                ]
            },
            select: { id: true, amount: true, direction: true, journalHead: { select: { ledgerId: true } } }
        })
        : [];

    if (orphanJournals.length) {
        await prisma.journal.deleteMany({ where: { id: { in: orphanJournals.map(j => j.id) } } });
    }

    const leftoverEntries = copyIds.length
        ? await prisma.ledgerEntry.findMany({
            where: { ledgerId: { in: copyIds } },
            select: { id: true }
        })
        : [];
    if (leftoverEntries.length) {
        await prisma.ledgerEntry.deleteMany({ where: { id: { in: leftoverEntries.map(e => e.id) } } });
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
        cd: a.cd, cc: a.cc, oc: a.oc, pd: a.pd, pc: a.pc
    };
    const wantLeaves: Record<string, { cc?: number; cd?: number; oc?: number }> = {
        "Loans (Liability) > Unsecured Loans > Loan From Directors > Mahima Menda - Loan From Director": { oc: 21297518, cc: 13270656 },
        "Loans (Liability) > Unsecured Loans > Loan From Directors > Sandeep Singh - Loan From Director": { oc: 2289320.62, cc: 8487413.62 },
        "Loans (Liability) > Unsecured Loans > Unsecured from Bank > AXIS BANK BPR032712902112": { cc: 5852483 },
        "Loans (Liability) > Unsecured Loans > Unsecured from Bank > AXIS CORPORATE CARD 0344": { cc: 8803859.19 },
        "Loans (Liability) > Unsecured Loans > Unsecured from Bank > HDFC CORPORATE CARD - V2P 3288": { oc: 2024780.12, cc: 2126019.44 },
        "Loans (Liability) > Unsecured Loans > Unsecured from Bank > HDFC CORPORATE CARD - V2P 3767": { oc: 3644604.86, cc: 0 },
        "Loans (Liability) > Unsecured Loans > Unsecured from Bank > IDBI BANK LIMITED": { cc: 70001199.36 },
        "Loans (Liability) > Unsecured Loans > Unsecured from Other than Bank > Art Infrastructure Pvt Ltd - Loan A/c": { oc: 39796150.43, cc: 40000000 },
        "Loans (Liability) > Unsecured Loans > Unsecured from Other than Bank > Auriolus Finvest Pvt Ltd (BIZFUNDS)": { oc: 1891761.06, cc: 2465207.06 },
        "Loans (Liability) > Unsecured Loans > Unsecured from Other than Bank > L &T FINANCE LIMITED BL250613256600976": { cc: 6110418.48 },
        "Loans (Liability) > Unsecured Loans > Unsecured from Other than Bank > TATA CAPITAL LIMITED": { oc: 50497520, cc: 50486724.3 },
        "Loans (Liability) > Unsecured Loans > Unsecured from Other than Bank > UNITY SMALL FINANCE BANK LTD": { oc: 2276085, cc: 351569 },
        "Loans (Liability) > Unsecured Loans > Unsecured from Other than Bank > MAS FINANCIAL SERVICES LTD -5391230": { oc: 3365154, cc: 1214105 }
    };
    const leafDiffs = Object.entries(wantLeaves).map(([path, want]) => {
        const a = pick(path) || pick(path.replace(" > " + path.split(" > ").slice(-1)[0], "") + " > " + path.split(" > ").slice(-1)[0]);
        const node = all.find(n => n.path === path || n.path.endsWith(" > " + path.split(" > ").slice(-1)[0]) && n.path.includes("Unsecured"));
        const x = node && {
            oc: node.node.openingCredit, cc: node.node.closingCredit, cd: node.node.closingDebit,
            pd: node.node.periodDebit, pc: node.node.periodCredit
        };
        return {
            path: node?.path || path,
            want,
            got: x,
            dCc: x ? Number((Number(x.cc || 0) - Number(want.cc || 0)).toFixed(2)) : null,
            dCd: x ? Number((Number(x.cd || 0) - Number(want.cd || 0)).toFixed(2)) : null
        };
    });
    const guard = all.filter(x =>
        /Duties & Taxes$|Sundry Creditors$|Bank OD A\/c & CC A\/c$/.test(x.path)
    ).map(x => ({
        path: x.path, cd: x.node.closingDebit, cc: x.node.closingCredit,
        oc: x.node.openingCredit, od: x.node.openingDebit
    }));
    console.log(JSON.stringify({
        copies: unsecCopies.length,
        deletedJournals: orphanJournals.length,
        deletedJournalAmt: money(orphanJournals.reduce((s, j) => s + cents(j.amount), 0)),
        deletedEntries: leftoverEntries.length,
        vsPdf: {
            parent: diff(pick("Loans (Liability) > Unsecured Loans"), pdf.parent),
            dir: diff(pick("Loans (Liability) > Unsecured Loans > Loan From Directors"), pdf.dir),
            bank: diff(pick("Loans (Liability) > Unsecured Loans > Unsecured from Bank"), pdf.bank),
            other: diff(pick("Loans (Liability) > Unsecured Loans > Unsecured from Other than Bank"), pdf.other)
        },
        leafDiffs,
        leaves: all.filter(x => /Loans \(Liability\) > Unsecured/.test(x.path) && (x.node.children || []).length === 0).map(x => ({
            path: x.path, oc: x.node.openingCredit, pd: x.node.periodDebit, pc: x.node.periodCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit
        })),
        guard
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
