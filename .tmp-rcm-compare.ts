import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const IDS: Record<string, string> = {
    "INPUT RCM CGST": "d0952654-53e8-4667-bd16-014166938cfb",
    "INPUT RCM SGST": "d09e0de1-20a0-412a-bf7b-94c456acc41f",
    "OUTPUT RCM CGST": "b4f6f655-1758-48af-8879-0f326003289c",
    "OUTPUT RCM SGST": "2ae9958b-2f62-4f2e-a9e1-88dbe618d789",
    "INPUT RCM IGST": "2d7d4268-cd9a-480d-9038-8f74ee912c8a",
    "OUTPUT RCM IGST": "784d1405-9948-4d58-984e-1c912ddafd36"
};

(async () => {
    const excel = JSON.parse(fs.readFileSync(".tmp-rcm-sheet-RCM Ledger Wise.json", "utf8")).rows as any[];
    const fy = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: Object.values(IDS) },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: {
            id: true, ledgerId: true, entryType: true, amount: true,
            voucher: { select: { id: true, voucherNo: true, voucherType: true, voucherDate: true, journals: { select: { id: true, status: true } } } }
        }
    });
    const used = new Set<number>();
    const missing: any[] = [];
    const extra: any[] = [];
    const excelPeriod = excel.filter(r => {
        const t = String(r["Journal Name / Type"] || "");
        return !/opening/i.test(t);
    });
    for (const r of excelPeriod) {
        const name = String(r["Ledger / Account Name"] || "").trim();
        const id = IDS[name];
        if (!id) continue;
        const side = Number(r["Debit Amount"] || 0) ? "DEBIT" : "CREDIT";
        const amt = Number(r["Debit Amount"] || r["Credit Amount"] || 0);
        const no = String(r["Voucher Number"] ?? "").trim();
        const idx = fy.findIndex((e, i) =>
            !used.has(i) && e.ledgerId === id && e.entryType === side && e.voucher.voucherNo === no && cents(e.amount) === cents(amt)
        );
        if (idx >= 0) used.add(idx);
        else missing.push({ name, no, side, amt, type: r["Journal Name / Type"], date: r["Date"], narr: r["Narration"] });
    }
    fy.forEach((e, i) => {
        if (used.has(i)) return;
        extra.push({
            id: e.id, ledgerId: e.ledgerId, no: e.voucher.voucherNo, type: e.voucher.voucherType,
            side: e.entryType, amt: Number(e.amount)
        });
    });
    const missByLedger: Record<string, any> = {};
    for (const m of missing) {
        const s = missByLedger[m.name] ||= { n: 0, dr: 0, cr: 0 };
        s.n += 1;
        if (m.side === "DEBIT") s.dr += m.amt; else s.cr += m.amt;
    }
    const extraByLedger: Record<string, any> = {};
    for (const e of extra) {
        const name = Object.keys(IDS).find(k => IDS[k] === e.ledgerId) || e.ledgerId;
        const s = extraByLedger[name] ||= { n: 0, dr: 0, cr: 0 };
        s.n += 1;
        if (e.side === "DEBIT") s.dr += e.amt; else s.cr += e.amt;
    }
    const missNos = [...new Set(missing.map(m => m.no))];
    const hosts = await prisma.voucher.findMany({
        where: { branchId: BRANCH, voucherNo: { in: missNos.slice(0, 800) } },
        select: {
            id: true, voucherNo: true, voucherType: true, voucherDate: true,
            journals: { select: { id: true, status: true } },
            _count: { select: { entries: true } }
        }
    });
    const hostByNo = new Map(hosts.map(h => [h.voucherNo, h]));
    fs.writeFileSync(".tmp-rcm-compare.json", JSON.stringify({ missing, extra, missByLedger, extraByLedger }, null, 2));
    console.log(JSON.stringify({
        excelN: excelPeriod.length, dbN: fy.length, matched: used.size,
        missingN: missing.length, extraN: extra.length,
        missByLedger, extraByLedger,
        missingSample: missing.slice(0, 12),
        extraSample: extra.slice(0, 8),
        missNos: missNos.length,
        hostHits: missNos.filter(n => hostByNo.has(n)).length,
        noHostSample: missNos.filter(n => !hostByNo.has(n)).slice(0, 15)
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
