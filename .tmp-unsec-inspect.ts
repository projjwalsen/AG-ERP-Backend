import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

const NAMES = [
    "Art Infrastructure Pvt Ltd - Loan A/c",
    "Auriolus Finvest Pvt Ltd (BIZFUNDS)",
    "AXIS BANK BPR032712902112",
    "AXIS CORPORATE CARD 0344",
    "HDFC CORPORATE CARD -9607",
    "HDFC CORPORATE CARD - V2P 3288",
    "HDFC CORPORATE CARD - V2P 3767",
    "IDBI BANK LIMITED",
    "L&T Finance Holdings Limited. BL231224040100133",
    "L &T FINANCE LIMITED BL250613256600976",
    "MAS FINANCIAL SERVICES LTD -5391230",
    "Mahima Menda - Loan From Director",
    "Sandeep Singh - Loan From Director",
    "SHREE GURU KRIPA ENTERPRISES (DR)",
    "TATA CAPITAL LIMITED",
    "UNITY SMALL FINANCE BANK LTD",
    "AXIS BANK LOAN - BPR064708241270",
    "CLIX CAPITAL SERVICES PVT LTD",
    "HDFC CORPORATE CARD -4385",
    "ICICI Business Loan - UPMUM00046126149",
    "IVC LOGISTICS LIMITED",
    "MAS FINANCIAL SERVICES LTD - VENDOR",
    "MONEYWISE FINANCIAL SERICES PVT LTD - BL00711",
    "POONAWALA FINCORP LTD - BLU0027DSC000006124326",
    "SHRIRAM FINANCE LIMITED",
    "VAISHNAVI ENTERPRISES",
    "YES BANK TERM LOAN 803LA42250690001",
    "YES BANK TERM LOAN 803LA42250920001",
    "Unsecured Loans",
    "Loan From Directors",
    "Unsecured from Bank",
    "Unsecured from Other than Bank"
];

(async () => {
    const groups = await prisma.ledgerGroup.findMany({
        where: {
            OR: [
                { name: { contains: "Unsecured", mode: "insensitive" } },
                { name: { contains: "Loan From Director", mode: "insensitive" } }
            ]
        },
        select: { id: true, name: true, code: true, parent: { select: { name: true, parent: { select: { name: true } } } } }
    });

    const ledgers = await prisma.ledger.findMany({
        where: {
            OR: NAMES.map(n => ({ name: { contains: n.slice(0, 24), mode: "insensitive" as const } }))
        },
        select: {
            id: true, name: true, category: true, nature: true, isActive: true, branchId: true,
            openingDebit: true, openingCredit: true,
            group: { select: { id: true, name: true, code: true, parent: { select: { name: true, parent: { select: { name: true } } } } } }
        }
    });

    const sums = [];
    for (const l of ledgers) {
        const entries = await prisma.ledgerEntry.findMany({
            where: { ledgerId: l.id },
            select: { entryType: true, amount: true, voucher: { select: { voucherType: true, voucherDate: true, branchId: true } } }
        });
        let openDr = 0, openCr = 0, perDr = 0, perCr = 0, nOpen = 0, nPer = 0;
        for (const e of entries) {
            if (e.voucher.branchId && e.voucher.branchId !== BRANCH_ID) continue;
            const amt = cents(e.amount);
            if (e.voucher.voucherType === "OPENING_BALANCE") {
                nOpen += 1;
                if (e.entryType === "DEBIT") openDr += amt; else openCr += amt;
            } else if (e.voucher.voucherDate >= START && e.voucher.voucherDate <= END) {
                nPer += 1;
                if (e.entryType === "DEBIT") perDr += amt; else perCr += amt;
            }
        }
        sums.push({
            id: l.id, name: l.name, category: l.category, nature: l.nature, active: l.isActive, branchId: l.branchId,
            group: `${l.group?.parent?.parent?.name || ""} > ${l.group?.parent?.name || ""} > ${l.group?.name}`,
            groupId: l.group?.id, groupCode: l.group?.code,
            nOpen, openDr: money(openDr), openCr: money(openCr),
            nPer, perDr: money(perDr), perCr: money(perCr),
            closeSigned: money(openDr - openCr + perDr - perCr)
        });
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
    const hits = walk(report.tree || []).filter(x =>
        /unsecured|loan from director|60434886441|bank od/i.test(x.path)
        && /Loans \(Liability\)/i.test(x.path)
    );

    console.log(JSON.stringify({
        groups,
        ledgers: sums.sort((a, b) => a.name.localeCompare(b.name)),
        tb: hits.map(x => ({
            path: x.path,
            od: x.node.openingDebit, oc: x.node.openingCredit,
            pd: x.node.periodDebit, pc: x.node.periodCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit,
            children: (x.node.children || []).map((c: any) => c.name)
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
