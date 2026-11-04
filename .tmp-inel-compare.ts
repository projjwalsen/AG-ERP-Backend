import "dotenv/config";
import { readFileSync } from "fs";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const TARGETS = [
    { name: "Ineligible ITC 17(5) -CGST", pdf: ".tmp-listed-inel_cgst.json", close: 192508.71 },
    { name: "Ineligible ITC 17(5) -SGST", pdf: ".tmp-listed-inel_sgst.json", close: 192508.71 },
    { name: "Ineligible ITC 17(5) -IGST", pdf: ".tmp-listed-inel_igst.json", close: 1450830.88 }
];

const walk = (nodes: any[], path: string[] = []): any[] =>
    nodes.flatMap(node => {
        const next = [...path, node.name];
        return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
    });

const keyOf = (no: string, side: string, amt: number) =>
    `${String(no || "").replace(/\s+/g, "")}|${side}|${Math.round(amt * 100)}`;

(async () => {
    const ledgers = await prisma.ledger.findMany({
        where: { name: { contains: "Ineligible ITC 17(5)", mode: "insensitive" } },
        select: {
            id: true, name: true, isActive: true, category: true, branchId: true,
            group: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } }
        }
    });

    const perLedger = [];
    for (const l of ledgers) {
        const entries = await prisma.ledgerEntry.findMany({
            where: { ledgerId: l.id, voucher: { voucherDate: { gte: START, lte: END } } },
            select: {
                id: true, entryType: true, amount: true, narration: true,
                voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true, narration: true } }
            }
        });
        const dr = entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + Number(e.amount), 0);
        const cr = entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + Number(e.amount), 0);
        perLedger.push({
            id: l.id, name: l.name, active: l.isActive, cat: l.category, branchId: l.branchId,
            group: `${l.group?.parent?.parent?.name || ""} > ${l.group?.parent?.name || ""} > ${l.group?.name}`,
            n: entries.length, dr: Number(dr.toFixed(2)), cr: Number(cr.toFixed(2)),
            rows: entries.map(e => ({
                date: localDate(e.voucher.voucherDate),
                no: e.voucher.voucherNo,
                type: e.voucher.voucherType,
                side: e.entryType,
                amt: Number(e.amount)
            }))
        });
    }

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const all = walk(report.tree || []);
    const rates = all.find(x => /Rate/i.test(x.path) && /Indirect/i.test(x.path) && /Ineligible|Rate/i.test(x.node.name));
    const tb = TARGETS.map(t => {
        const hits = all.filter(x => x.node.name.toLowerCase() === t.name.toLowerCase());
        return {
            name: t.name,
            pdfClose: t.close,
            hits: hits.map(x => ({
                path: x.path,
                od: x.node.openingDebit, oc: x.node.openingCredit,
                pd: x.node.periodDebit, pc: x.node.periodCredit,
                cd: x.node.closingDebit, cc: x.node.closingCredit,
                childCount: (x.node.children || []).length
            }))
        };
    });

    const gaps = [];
    for (const t of TARGETS) {
        const pdf = JSON.parse(readFileSync(t.pdf, "utf8"));
        const dbLedgers = perLedger.filter(l => l.name.toLowerCase() === t.name.toLowerCase() && l.active);
        const dbRows = dbLedgers.flatMap(l => l.rows);
        const used = new Set<number>();
        const missing = [];
        for (const v of pdf.vouchers) {
            const idx = dbRows.findIndex((r, i) =>
                !used.has(i) &&
                String(r.no).replace(/\s+/g, "") === String(v.no || "").replace(/\s+/g, "") &&
                r.side === v.side &&
                Math.round(r.amt * 100) === Math.round(v.amount * 100)
            );
            if (idx >= 0) used.add(idx);
            else missing.push({ date: v.date, no: v.no, side: v.side, amt: v.amount, particular: v.particular, type: v.type });
        }
        const extra = dbRows.filter((_, i) => !used.has(i));
        gaps.push({
            name: t.name,
            pdfClose: pdf.closeSigned,
            pdfDr: pdf.perDr,
            pdfCr: pdf.perCr,
            db: dbLedgers.map(l => ({ id: l.id, group: l.group, n: l.n, dr: l.dr, cr: l.cr })),
            missingCount: missing.length,
            extraCount: extra.length,
            missing,
            extra: extra.slice(0, 30)
        });
    }

    console.log(JSON.stringify({
        ledgers: perLedger.map(l => ({ id: l.id, name: l.name, active: l.active, group: l.group, n: l.n, dr: l.dr, cr: l.cr })),
        ratesPath: rates && { path: rates.path, cd: rates.node.closingDebit, cc: rates.node.closingCredit },
        tb,
        gaps
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
