import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const LEDGERS: Record<string, string[]> = {
    kfd: ["760af6cd-3501-41e5-8e72-f702781eca47"],
    cb: ["d3dc36a5-f716-4bb5-b97d-c43b5cbcab9b", "cd37008f-f3fb-47bb-b73e-7269a2991e1f"],
    bomca: ["ac66bb2e-78f7-49a4-a6f6-6c6d83d1fd4b", "e57ff097-b461-435e-add1-525a9996e5ae"]
};
const PDF: Record<string, string> = {
    kfd: ".tmp-bank3-karnataka_fd_2401.json",
    cb: ".tmp-bank3-central_bank.json",
    bomca: ".tmp-bank3-bom_ca.json"
};

(async () => {
    const out: any = {};
    for (const key of Object.keys(LEDGERS)) {
        const pdf = JSON.parse(fs.readFileSync(PDF[key], "utf8"));
        const fy = await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: { in: LEDGERS[key] },
                voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
            },
            select: {
                id: true, ledgerId: true, entryType: true, amount: true, narration: true,
                voucher: {
                    select: {
                        id: true, voucherNo: true, voucherType: true, voucherDate: true,
                        entries: {
                            select: {
                                id: true, ledgerId: true, entryType: true, amount: true,
                                ledger: { select: { id: true, name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } } }
                            }
                        }
                    }
                }
            }
        });
        const dbRows = fy.map(e => ({
            id: e.id, ledgerId: e.ledgerId, no: e.voucher.voucherNo, type: e.voucher.voucherType,
            date: localDate(e.voucher.voucherDate), side: e.entryType, amt: Number(e.amount),
            others: e.voucher.entries.filter(x => x.id !== e.id).map(x => ({
                name: x.ledger.name, side: x.entryType, amt: Number(x.amount),
                group: `${x.ledger.group?.parent?.name || ""} > ${x.ledger.group?.name || ""}`
            }))
        }));
        const pdfRows = (pdf.vouchers as any[]).map(v => ({
            no: String(v.no), date: v.date, side: v.side, amt: v.amount, particular: v.particular, type: v.type
        }));
        const used = new Set<number>();
        const matched: any[] = [];
        const missing: any[] = [];
        for (const p of pdfRows) {
            const idx = dbRows.findIndex((d, i) => !used.has(i) && d.no === p.no && d.side === p.side && cents(d.amt) === cents(p.amt));
            if (idx >= 0) {
                used.add(idx);
                matched.push({ no: p.no, amt: p.amt, side: p.side });
            } else {
                const sameNo = dbRows.filter((d, i) => !used.has(i) && d.no === p.no && d.side === p.side);
                missing.push({ pdf: p, dbSameNo: sameNo });
            }
        }
        const extra = dbRows.filter((_, i) => !used.has(i));
        const amtGap = extra.filter(e => e.side === "CREDIT").reduce((s, e) => s + e.amt, 0)
            - extra.filter(e => e.side === "DEBIT").reduce((s, e) => s + e.amt, 0)
            - missing.filter((m: any) => m.pdf.side === "CREDIT").reduce((s: number, m: any) => s + m.pdf.amt, 0)
            + missing.filter((m: any) => m.pdf.side === "DEBIT").reduce((s: number, m: any) => s + m.pdf.amt, 0);
        out[key] = {
            pdfN: pdfRows.length, dbN: dbRows.length, matched: matched.length,
            missingN: missing.length, extraN: extra.length,
            missing: missing.slice(0, 80),
            extra: extra.slice(0, 80),
            extraCr: extra.filter(e => e.side === "CREDIT").reduce((s, e) => s + e.amt, 0),
            extraDr: extra.filter(e => e.side === "DEBIT").reduce((s, e) => s + e.amt, 0),
            missCr: missing.filter((m: any) => m.pdf.side === "CREDIT").reduce((s: number, m: any) => s + m.pdf.amt, 0),
            missDr: missing.filter((m: any) => m.pdf.side === "DEBIT").reduce((s: number, m: any) => s + m.pdf.amt, 0)
        };
    }

    const specialNos = ["14080", "KFD401-CONTRA-20251114", "8908", "CB-CONTRA-20260307", "17209", "13784", "3829"];
    const special = await prisma.voucher.findMany({
        where: { voucherNo: { in: specialNos } },
        select: {
            id: true, voucherNo: true, voucherType: true, voucherDate: true, branchId: true,
            journals: { select: { id: true, status: true, direction: true, amount: true } },
            entries: {
                select: {
                    id: true, ledgerId: true, entryType: true, amount: true, narration: true,
                    ledger: { select: { name: true, isActive: true, group: { select: { name: true, parent: { select: { name: true } } } } } }
                }
            }
        }
    });
    out.special = special.map(v => ({
        no: v.voucherNo, type: v.voucherType, date: localDate(v.voucherDate),
        branch: v.branchId, journals: v.journals,
        entries: v.entries.map(e => ({
            id: e.id, ledgerId: e.ledgerId, name: e.ledger.name, active: e.ledger.isActive,
            group: `${e.ledger.group?.parent?.name} > ${e.ledger.group?.name}`,
            side: e.entryType, amt: Number(e.amount), narr: (e.narration || "").slice(0, 80)
        }))
    }));
    fs.writeFileSync(".tmp-bank3-compare.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify({
        kfd: { ...out.kfd, missing: out.kfd.missing, extra: out.kfd.extra },
        cb: { ...out.cb, missing: out.cb.missing, extra: out.cb.extra },
        bomca: {
            pdfN: out.bomca.pdfN, dbN: out.bomca.dbN, matched: out.bomca.matched,
            missingN: out.bomca.missingN, extraN: out.bomca.extraN,
            extraCr: out.bomca.extraCr, extraDr: out.bomca.extraDr,
            missCr: out.bomca.missCr, missDr: out.bomca.missDr,
            missing: out.bomca.missing.map((m: any) => ({
                no: m.pdf.no, date: m.pdf.date, side: m.pdf.side, amt: m.pdf.amt, particular: m.pdf.particular,
                db: m.dbSameNo.map((d: any) => ({ amt: d.amt, others: d.others }))
            })),
            extra: out.bomca.extra.map((e: any) => ({ no: e.no, date: e.date, side: e.side, amt: e.amt, others: e.others }))
        },
        special: out.special
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
