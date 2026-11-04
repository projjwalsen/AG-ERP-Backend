import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";
import * as fs from "fs";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

const PDF: Record<string, { od: number; oc: number; cd: number; cc: number }> = {
    "ACCELERATOR GENERAL TRADING LLC": { od: 21011561.77, oc: 0, cd: 21011561.77, cc: 0 },
    "AINUMPUDI SURESH VARMA": { od: 0, oc: 0, cd: 50000, cc: 0 },
    "ALOIS BUILDERS AND INF": { od: 0, oc: 0, cd: 1000000, cc: 0 },
    "AML MOTORS PVT LTD": { od: 0, oc: 0, cd: 29344, cc: 0 },
    "Anjali Electricals": { od: 44110, oc: 0, cd: 44110, cc: 0 },
    "ASPHALTERA PRIVATE LIMITED": { od: 3800000, oc: 0, cd: 237900, cc: 0 },
    "AVNTIKA ENTERPRISE CRS": { od: 0, oc: 0, cd: 6329258, cc: 0 },
    "CLASSIC PETRO & ENERGY PRIVATE LIMITED CRS": { od: 0, oc: 0, cd: 0, cc: 0 },
    "Darsh Enterprises (CR)": { od: 0, oc: 0, cd: 0, cc: 0 },
    "DREAMZZ MAKERS EVENTS AN": { od: 0, oc: 0, cd: 100000, cc: 0 },
    "EKVIRA TRANSPORT AND LOGISTICS": { od: 0, oc: 316155, cd: 236958, cc: 0 },
    "EMIT INTERNATIONAL FZ LLC": { od: 32691837.61, oc: 0, cd: 13515828.93, cc: 0 },
    "GLOBAL PLASTO CHEM": { od: 0, oc: 0, cd: 1199, cc: 0 },
    "HINDUSTAN PETROLEUM CORPORATION LIMITED": { od: 1487825.21, oc: 0, cd: 45824.05, cc: 0 },
    "INDIAIDEAS.COM": { od: 0, oc: 0, cd: 6478.36, cc: 0 },
    "Indian Oil Corporation Limited-GJ": { od: 91016, oc: 0, cd: 91313, cc: 0 },
    "INDIAN OIL CORPORATION LIMITED - MH": { od: 0, oc: 0, cd: 6664, cc: 0 },
    "JALDEV SHIPPING AGENCY": { od: 0, oc: 0, cd: 87886, cc: 0 },
    "KHANDOBA BIOREFINERIES PRIVATE LIMITED": { od: 9836656, oc: 0, cd: 0, cc: 0 },
    "K M ENTERPRISE": { od: 0, oc: 0, cd: 0, cc: 0 },
    "KS Oil Corporation - CR": { od: 0, oc: 0, cd: 4080, cc: 0 },
    "M1 EXCHANGE": { od: 0, oc: 0, cd: 0, cc: 0 },
    "MAYRA PETROLEUM FZCO": { od: 11475470.6, oc: 0, cd: 11475470.6, cc: 0 },
    "MSTC LTD": { od: 275208, oc: 0, cd: 274028, cc: 0 },
    "Mynd Solutions Pvt. Ltd.": { od: 0, oc: 0, cd: 2156, cc: 0 },
    "NAYARA ENERGY LIMITED": { od: 0, oc: 2028, cd: 0, cc: 0 },
    "NAZPAL OIL ENERGY L.L.C": { od: 5850826.45, oc: 0, cd: 5850826.45, cc: 0 },
    "NEPTUNE PETROCHEMICALS LIMITED - UP CRS": { od: 0, oc: 0, cd: 0, cc: 0 },
    "RAAJ UNOCAL LUBRICANTS LTD": { od: 0, oc: 86650707.39, cd: 7071843.37, cc: 0 },
    "ROYAL AUTOCRYSTAL SERVICES PRIVATE LIMITED": { od: 0, oc: 0, cd: 3594, cc: 0 },
    "ROYAL ENTERPRISES": { od: 0, oc: 0, cd: 416, cc: 0 },
    "SANDEEPDADA THAKUR FOUNDATION": { od: 0, oc: 0, cd: 100000, cc: 0 },
    "SHANTI HEAVY DUTY EARTH MOVERS": { od: 0, oc: 0, cd: 49500, cc: 0 },
    "SHREE HARI ENTERPRISES": { od: 0, oc: 39141, cd: 26334, cc: 0 },
    "SIDDHARTH TRADERS": { od: 2100000, oc: 0, cd: 2100000, cc: 0 },
    "SIGMA PETROCHEM": { od: 0, oc: 0, cd: 1490, cc: 0 },
    "SILVERBACK INFRA PRIVATE LIMITED": { od: 0, oc: 0, cd: 0, cc: 0 },
    "STAR MOTORS": { od: 0, oc: 0, cd: 0, cc: 0 },
    "SUKHMANI OIL AND LUBE CRS": { od: 0, oc: 0, cd: 5783, cc: 0 },
};

(async () => {
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
    const parent = all.find(x => x.path === "Current Assets > Loans & Advances (Asset) > Advance to S. Creditors");
    const children = all.filter(x => x.path.startsWith("Current Assets > Loans & Advances (Asset) > Advance to S. Creditors > "));
    const mismatches: any[] = [];
    for (const c of children) {
        const name = c.node.name;
        const pdf = PDF[name];
        if (!pdf) {
            mismatches.push({ name, issue: "not in PDF", tb: { od: c.node.openingDebit, oc: c.node.openingCredit, pd: c.node.periodDebit, pc: c.node.periodCredit, cd: c.node.closingDebit, cc: c.node.closingCredit } });
            continue;
        }
        const same =
            cents(c.node.openingDebit) === cents(pdf.od) &&
            cents(c.node.openingCredit) === cents(pdf.oc) &&
            cents(c.node.closingDebit) === cents(pdf.cd) &&
            cents(c.node.closingCredit) === cents(pdf.cc);
        if (!same) {
            mismatches.push({
                name,
                pdf,
                tb: { od: c.node.openingDebit, oc: c.node.openingCredit, pd: c.node.periodDebit, pc: c.node.periodCredit, cd: c.node.closingDebit, cc: c.node.closingCredit },
                closeGap: money(cents(c.node.closingDebit) - cents(c.node.closingCredit) - (cents(pdf.cd) - cents(pdf.cc)))
            });
        }
    }
    const missingPdf = Object.keys(PDF).filter(n => !children.some(c => c.node.name === n));

    const groups = await prisma.ledgerGroup.findMany({
        where: { name: { contains: "Advance to S", mode: "insensitive" } },
        select: { id: true }
    });
    const allGroups = await prisma.ledgerGroup.findMany({ select: { id: true, name: true, parentId: true } });
    const desc = new Set(groups.map(g => g.id));
    let grew = true;
    while (grew) {
        grew = false;
        for (const g of allGroups) {
            if (g.parentId && desc.has(g.parentId) && !desc.has(g.id)) { desc.add(g.id); grew = true; }
        }
    }
    const ledgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...desc] } },
        select: { id: true, name: true, category: true, isActive: true, branchId: true, groupId: true }
    });
    const mismatchNames = new Set(mismatches.map(m => m.name));
    const dups = new Map<string, typeof ledgers>();
    for (const l of ledgers) {
        const arr = dups.get(l.name) || [];
        arr.push(l);
        dups.set(l.name, arr);
    }
    const dupInfo: any[] = [];
    for (const [name, copies] of dups) {
        if (copies.length < 2 && !mismatchNames.has(name)) continue;
        const ids = copies.map(c => c.id);
        const entries = await prisma.ledgerEntry.findMany({
            where: { ledgerId: { in: ids }, voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } } },
            select: { ledgerId: true, entryType: true, amount: true }
        });
        const openings = await prisma.ledgerEntry.findMany({
            where: { ledgerId: { in: ids }, voucher: { voucherType: "OPENING_BALANCE" } },
            select: { ledgerId: true, entryType: true, amount: true }
        });
        dupInfo.push({
            name,
            copies: copies.map(c => {
                const es = entries.filter(e => e.ledgerId === c.id);
                const os = openings.filter(e => e.ledgerId === c.id);
                const dr = es.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
                const cr = es.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
                const oDr = os.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
                const oCr = os.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
                return { id: c.id, active: c.isActive, cat: c.category, n: es.length, dr: money(dr), cr: money(cr), oDr: money(oDr), oCr: money(oCr), close: money(oDr - oCr + dr - cr) };
            })
        });
    }

    // same-name ledgers outside this group (likely SC)
    const mismatchLedgerNames = [...mismatchNames];
    const others = mismatchLedgerNames.length ? await prisma.ledger.findMany({
        where: { name: { in: mismatchLedgerNames }, groupId: { notIn: [...desc] } },
        select: {
            id: true, name: true, category: true, isActive: true,
            group: { select: { name: true, parent: { select: { name: true } } } }
        }
    }) : [];

    const out = {
        parent: parent ? {
            od: parent.node.openingDebit, oc: parent.node.openingCredit,
            pd: parent.node.periodDebit, pc: parent.node.periodCredit,
            cd: parent.node.closingDebit, cc: parent.node.closingCredit
        } : null,
        pdf: { od: 88664511.64, oc: 87008031.39, cd: 69759846.53, cc: 0 },
        parentGap: parent ? money(cents(parent.node.closingDebit) - cents(parent.node.closingCredit) - cents(69759846.53)) : null,
        mismatchCount: mismatches.length,
        mismatches,
        missingPdf,
        extraTb: children.filter(c => !PDF[c.node.name]).map(c => c.node.name),
        dupInfo,
        others
    };
    fs.writeFileSync(".tmp-advsc-inspect.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify({
        parent: out.parent,
        parentGap: out.parentGap,
        mismatchCount: out.mismatchCount,
        mismatches: mismatches.map(m => ({ name: m.name, closeGap: m.closeGap, issue: m.issue, tbCd: m.tb?.cd, tbCc: m.tb?.cc, pdfCd: m.pdf?.cd, pdfCc: m.pdf?.cc })),
        missingPdf,
        extraTb: out.extraTb,
        dups: dupInfo.map(d => ({ name: d.name, copies: d.copies })),
        others: others.map(o => ({ name: o.name, id: o.id, active: o.isActive, group: `${o.group?.parent?.name} > ${o.group?.name}` }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
