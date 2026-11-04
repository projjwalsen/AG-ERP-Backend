import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "")
    .replace(/\s*-\s*Sundry\s+(Debtor|Creditor)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/[–—]/g, "-");

(async () => {
    const targets = JSON.parse(fs.readFileSync(".tmp-sd-targets.json", "utf8")).leaves as any[];
    const pdfBy = new Map<string, any>();
    for (const t of targets) {
        const k = norm(t.name);
        const prev = pdfBy.get(k);
        if (!prev) pdfBy.set(k, { ...t, names: [t.name] });
        else {
            prev.od += t.od; prev.oc += t.oc; prev.cd += t.cd; prev.cc += t.cc;
            prev.names.push(t.name);
        }
    }

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
    const parent = all.find(x => x.path === "Current Assets > Sundry Debtors");
    const children = all.filter(x => x.path.startsWith("Current Assets > Sundry Debtors > "));

    const tbBy = new Map<string, any>();
    for (const c of children) {
        const k = norm(c.node.name);
        const row = {
            name: c.node.name, k,
            od: Number(c.node.openingDebit || 0), oc: Number(c.node.openingCredit || 0),
            pd: Number(c.node.periodDebit || 0), pc: Number(c.node.periodCredit || 0),
            cd: Number(c.node.closingDebit || 0), cc: Number(c.node.closingCredit || 0)
        };
        const prev = tbBy.get(k);
        if (!prev) tbBy.set(k, row);
        else {
            prev.od += row.od; prev.oc += row.oc; prev.pd += row.pd; prev.pc += row.pc;
            prev.cd += row.cd; prev.cc += row.cc;
            prev.name += " | " + row.name;
        }
    }

    const mismatches: any[] = [];
    const extras: any[] = [];
    for (const [k, tb] of tbBy) {
        const pdf = pdfBy.get(k);
        if (!pdf) {
            extras.push(tb);
            continue;
        }
        if (
            cents(tb.od) !== cents(pdf.od) || cents(tb.oc) !== cents(pdf.oc) ||
            cents(tb.cd) !== cents(pdf.cd) || cents(tb.cc) !== cents(pdf.cc)
        ) {
            mismatches.push({
                k, name: tb.name, pdfName: pdf.name,
                pdf: { od: pdf.od, oc: pdf.oc, cd: pdf.cd, cc: pdf.cc },
                tb: { od: tb.od, oc: tb.oc, pd: tb.pd, pc: tb.pc, cd: tb.cd, cc: tb.cc },
                closeGap: money(cents(tb.cd) - cents(tb.cc) - (cents(pdf.cd) - cents(pdf.cc))),
                openGap: money(cents(tb.od) - cents(tb.oc) - (cents(pdf.od) - cents(pdf.oc)))
            });
        }
    }
    const missing = [...pdfBy.entries()].filter(([k, p]) =>
        !tbBy.has(k) && (cents(p.cd) || cents(p.cc) || cents(p.od) || cents(p.oc))
    ).map(([k, p]) => p);

    mismatches.sort((a, b) => Math.abs(b.closeGap) - Math.abs(a.closeGap));

    // ledgers under both SD groups
    const groups = await prisma.ledgerGroup.findMany({
        where: { name: { equals: "Sundry Debtors", mode: "insensitive" } },
        select: { id: true, name: true, code: true, parentId: true }
    });
    const allGroups = await prisma.ledgerGroup.findMany({ select: { id: true, parentId: true } });
    const desc = new Set(groups.map(g => g.id));
    let grew = true;
    while (grew) {
        grew = false;
        for (const g of allGroups) {
            if (g.parentId && desc.has(g.parentId) && !desc.has(g.id)) { desc.add(g.id); grew = true; }
        }
    }
    const mismatchKeys = new Set(mismatches.map(m => m.k).concat(extras.map(e => e.k)));
    const ledgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...desc] } },
        select: {
            id: true, name: true, category: true, isActive: true, groupId: true,
            openingDebit: true, openingCredit: true,
            group: { select: { name: true, parent: { select: { name: true } } } }
        }
    });
    const focus = ledgers.filter(l => mismatchKeys.has(norm(l.name)) || extras.some(e => e.k === norm(l.name)));
    const copies: any[] = [];
    const byK = new Map<string, typeof ledgers>();
    for (const l of focus) {
        const k = norm(l.name);
        const arr = byK.get(k) || [];
        arr.push(l);
        byK.set(k, arr);
    }
    for (const [k, copiesL] of byK) {
        const ids = copiesL.map(c => c.id);
        const entries = await prisma.ledgerEntry.findMany({
            where: { ledgerId: { in: ids }, voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } } },
            select: { ledgerId: true, entryType: true, amount: true, voucher: { select: { voucherType: true } } }
        });
        copies.push({
            k,
            copies: copiesL.map(c => {
                const es = entries.filter(e => e.ledgerId === c.id);
                const dr = es.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
                const cr = es.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
                const byType = es.reduce((a: any, e) => {
                    const t = e.voucher.voucherType;
                    a[t] = a[t] || { n: 0, dr: 0, cr: 0 };
                    a[t].n += 1;
                    if (e.entryType === "DEBIT") a[t].dr += Number(e.amount); else a[t].cr += Number(e.amount);
                    return a;
                }, {});
                return {
                    id: c.id, name: c.name, cat: c.category, active: c.isActive,
                    group: `${c.group?.parent?.name} > ${c.group?.name}`,
                    n: es.length, dr: money(dr), cr: money(cr), byType,
                    oDr: Number(c.openingDebit || 0), oCr: Number(c.openingCredit || 0)
                };
            })
        });
    }

    const out = {
        parent: parent && {
            od: parent.node.openingDebit, oc: parent.node.openingCredit,
            pd: parent.node.periodDebit, pc: parent.node.periodCredit,
            cd: parent.node.closingDebit, cc: parent.node.closingCredit
        },
        pdf: { od: 822816622.76, oc: 12551933.96, cd: 673716070.65, cc: 16902464 },
        parentGap: parent ? money(cents(parent.node.closingDebit) - cents(parent.node.closingCredit) - (cents(673716070.65) - cents(16902464))) : null,
        tbChildN: children.length, pdfN: pdfBy.size, matchedOk: pdfBy.size - mismatches.length - missing.length,
        mismatchN: mismatches.length, extraN: extras.length, missingN: missing.length,
        mismatches, extras, missing,
        copies
    };
    fs.writeFileSync(".tmp-sd-compare.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify({
        parent: out.parent, parentGap: out.parentGap,
        tbChildN: out.tbChildN, mismatchN: out.mismatchN, extraN: out.extraN, missingN: out.missingN,
        mismatches: mismatches.map(m => ({ name: m.name, closeGap: m.closeGap, openGap: m.openGap, tbCd: m.tb.cd, tbCc: m.tb.cc, pdfCd: m.pdf.cd, pdfCc: m.pdf.cc, tbOd: m.tb.od, pdfOd: m.pdf.od })),
        extras: extras.map(e => ({ name: e.name, cd: e.cd, cc: e.cc, od: e.od })),
        missing: missing.map(m => ({ name: m.name, cd: m.cd, cc: m.cc, od: m.od })),
        copies: copies.map(c => ({ k: c.k, copies: c.copies.map((x: any) => ({ id: x.id, cat: x.cat, active: x.active, n: x.n, dr: x.dr, cr: x.cr, byType: x.byType })) }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
