import "dotenv/config";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "fdd97fd1-f05b-4cce-8524-738751747f80";
const money = (v: unknown) => Number(Number(v || 0).toFixed(2));
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const norm = (v: unknown) => String(v || "").replace(/_x000D_/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

(async () => {
    const missing: any[] = JSON.parse(fs.readFileSync(".tmp-duties-gap-ledgers.json", "utf8")).missing;
    const groups = await prisma.ledgerGroup.findMany();
    const byId = new Map(groups.map(g => [g.id, g]));
    const pathOf = (id: string) => {
        const parts: string[] = [];
        let g = byId.get(id);
        const seen = new Set<string>();
        while (g && !seen.has(g.id)) {
            seen.add(g.id); parts.unshift(g.name);
            g = g.parentId ? byId.get(g.parentId) : undefined;
        }
        return parts.join(" > ");
    };
    const ids = new Set([ROOT]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
            ids.add(g.id); changed = true;
        }
    }
    const dutiesLedgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...ids] } },
        select: { id: true, name: true, groupId: true }
    });
    const targetByName = new Map<string, string>();
    for (const l of dutiesLedgers) {
        const k = norm(l.name);
        const prev = targetByName.get(k);
        const nested = pathOf(l.groupId).includes("Duties & Taxes > Duties & Taxes");
        if (!prev || !nested) targetByName.set(k, l.id);
    }

    const purchaseLedger = await prisma.ledger.findFirst({
        where: { name: "Purchase - AG_ASHTAVINAYAKA_PETROCHEM_MH" },
        select: { id: true }
    });
    const roundLedger = await prisma.ledger.findFirst({
        where: { name: "Round Off", branchId: BRANCH_ID },
        select: { id: true }
    }) || await prisma.ledger.findFirst({ where: { name: "Round Off" }, select: { id: true } });
    const bankLedger = await prisma.ledger.findFirst({
        where: { name: { contains: "BANK OF MAHARASHTRA- C/C 60434886441" } },
        select: { id: true }
    });
    const scrapLedger = await prisma.ledger.findFirst({
        where: { name: "SCRAP DRUMS" },
        select: { id: true }
    });
    if (!purchaseLedger || !roundLedger || !bankLedger) {
        throw new Error(`Missing system ledger purchase=${purchaseLedger?.id} round=${roundLedger?.id} bank=${bankLedger?.id}`);
    }

    const purchaseNos = [...new Set(missing.filter(r => r.type === "Purchase").map(r => String(r.no)))];
    const saleNos = [...new Set(missing.filter(r => r.type === "Tax Invoice").map(r => String(r.no)))];
    const purchases = await prisma.purchase.findMany({
        where: { branchId: BRANCH_ID, invoiceNo: { in: purchaseNos } },
        select: {
            id: true, invoiceNo: true, invoiceDate: true, agencyId: true,
            subtotalAmount: true, roundOffAmount: true, grandTotal: true
        }
    });
    const sales = await prisma.sale.findMany({
        where: { branchId: BRANCH_ID, invoiceNo: { in: saleNos } },
        select: {
            id: true, invoiceNo: true, invoiceDate: true, agencyId: true,
            subTotalAmount: true, totalIGSTAmount: true
        }
    });
    const agencies = await prisma.agency.findMany({
        where: { id: { in: [...new Set([...purchases.map(p => p.agencyId), ...sales.map(s => s.agencyId)])] } },
        select: { id: true, ledger: { select: { id: true, name: true, category: true } } }
    });
    const vendorOf = (agencyId: string) => {
        const a = agencies.find(x => x.id === agencyId);
        return a?.ledger.find(l => l.category === "VENDOR") || a?.ledger[0];
    };
    const customerOf = (agencyId: string) => {
        const a = agencies.find(x => x.id === agencyId);
        return a?.ledger.find(l => l.category === "CUSTOMER") || a?.ledger[0];
    };

    const existingP = await prisma.voucher.findMany({
        where: { voucherType: "PURCHASE", sourceId: { in: purchases.map(p => p.id) } },
        select: { sourceId: true }
    });
    const existingS = await prisma.voucher.findMany({
        where: { voucherType: "SALE", sourceId: { in: sales.map(s => s.id) } },
        select: { sourceId: true }
    });
    const hasP = new Set(existingP.map(v => v.sourceId));
    const hasS = new Set(existingS.map(v => v.sourceId));

    const missingByNo = new Map<string, any[]>();
    for (const row of missing) {
        const k = `${row.type}|${norm(row.no)}`;
        missingByNo.set(k, [...(missingByNo.get(k) || []), row]);
    }

    let createdPurchases = 0, createdSales = 0, createdPayments = 0, skipped = 0;
    const errors: any[] = [];

    for (const p of purchases) {
        if (hasP.has(p.id)) { skipped += 1; continue; }
        const rows = missingByNo.get(`Purchase|${norm(p.invoiceNo)}`) || [];
        const vendor = vendorOf(p.agencyId);
        if (!vendor) { errors.push({ no: p.invoiceNo, reason: "no-vendor-ledger" }); continue; }
        const entries: { ledgerId: string; entryType: "DEBIT" | "CREDIT"; amount: number; narration: string }[] = [];
        const sub = money(p.subtotalAmount);
        if (sub) entries.push({ ledgerId: purchaseLedger.id, entryType: "DEBIT", amount: sub, narration: `PURCHASE|${p.invoiceNo}` });
        for (const row of rows) {
            const target = targetByName.get(norm(row.name));
            if (!target) { errors.push({ no: p.invoiceNo, reason: "no-target", name: row.name }); continue; }
            entries.push({
                ledgerId: target, entryType: row.side, amount: money(row.amount),
                narration: String(row.narration || p.invoiceNo).slice(0, 400)
            });
        }
        const round = money(p.roundOffAmount);
        if (round > 0) entries.push({ ledgerId: roundLedger.id, entryType: "DEBIT", amount: round, narration: "Round Off" });
        if (round < 0) entries.push({ ledgerId: roundLedger.id, entryType: "CREDIT", amount: money(-round), narration: "Round Off" });
        const grand = money(p.grandTotal);
        entries.push({ ledgerId: vendor.id, entryType: "CREDIT", amount: grand, narration: `PURCHASE|${p.invoiceNo}` });
        const dr = entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const cr = entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        const diff = dr - cr;
        if (diff !== 0) {
            entries.push({
                ledgerId: roundLedger.id,
                entryType: diff > 0 ? "CREDIT" : "DEBIT",
                amount: money(Math.abs(diff) / 100),
                narration: "Balance difference"
            });
        }
        await prisma.voucher.create({
            data: {
                id: randomUUID(),
                voucherNo: p.invoiceNo,
                voucherType: "PURCHASE",
                sourceId: p.id,
                branchId: BRANCH_ID,
                narration: `PURCHASE|${p.invoiceNo}`,
                voucherDate: p.invoiceDate || new Date("2025-03-31T18:30:00.000Z"),
                totalDebit: money(entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + Number(e.amount), 0)),
                totalCredit: money(entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + Number(e.amount), 0)),
                entries: {
                    create: entries.map(e => ({
                        ledgerId: e.ledgerId, branchId: BRANCH_ID, entryType: e.entryType,
                        amount: e.amount, narration: e.narration
                    }))
                }
            }
        });
        createdPurchases += 1;
    }

    for (const s of sales) {
        if (hasS.has(s.id)) { skipped += 1; continue; }
        const rows = missingByNo.get(`Tax Invoice|${norm(s.invoiceNo)}`) || [];
        const customer = customerOf(s.agencyId);
        if (!customer || !scrapLedger) { errors.push({ no: s.invoiceNo, reason: "no-customer-or-scrap" }); continue; }
        const igst = rows.filter(r => norm(r.name) === "OUTPUT IGST 18%").reduce((sum, r) => sum + money(r.amount), 0);
        const tcs = rows.filter(r => norm(r.name).includes("TCS ON SALE OF SCRAP")).reduce((sum, r) => sum + money(r.amount), 0);
        const salesAmt = money(s.subTotalAmount) || money(cents(s.totalIGSTAmount) ? Number(s.totalIGSTAmount) / 0.18 : 0);
        const debtor = money(salesAmt + igst + tcs);
        const tcsId = targetByName.get("TCS ON SALE OF SCRAP 1%");
        const igstId = targetByName.get("OUTPUT IGST 18%");
        if (!tcsId || !igstId) { errors.push({ no: s.invoiceNo, reason: "no-tcs-or-igst-ledger" }); continue; }
        const entries = [
            { ledgerId: customer.id, entryType: "DEBIT" as const, amount: debtor, narration: s.invoiceNo },
            { ledgerId: scrapLedger.id, entryType: "CREDIT" as const, amount: salesAmt, narration: "SCRAP DRUMS" },
            { ledgerId: igstId, entryType: "CREDIT" as const, amount: igst, narration: "OUTPUT IGST 18%" },
            { ledgerId: tcsId, entryType: "CREDIT" as const, amount: tcs, narration: "TCS ON SALE OF SCRAP 1%" }
        ].filter(e => e.amount > 0);
        await prisma.voucher.create({
            data: {
                id: randomUUID(),
                voucherNo: s.invoiceNo,
                voucherType: "SALE",
                sourceId: s.id,
                branchId: BRANCH_ID,
                narration: `SALE|${s.invoiceNo}`,
                voucherDate: s.invoiceDate || new Date("2025-03-31T18:30:00.000Z"),
                totalDebit: debtor,
                totalCredit: money(salesAmt + igst + tcs),
                entries: {
                    create: entries.map(e => ({
                        ledgerId: e.ledgerId, branchId: BRANCH_ID, entryType: e.entryType,
                        amount: e.amount, narration: e.narration
                    }))
                }
            }
        });
        createdSales += 1;
    }

    const tdsGoods = targetByName.get("TDS ON PURCHASE OF GOODS @0.10%");
    const tdsContract = targetByName.get("TDS ON CONTRACT");
    const existing11308 = await prisma.voucher.findFirst({
        where: { branchId: BRANCH_ID, voucherNo: "11308" },
        select: { id: true }
    });
    if (!existing11308 && tdsGoods) {
        await prisma.voucher.create({
            data: {
                id: randomUUID(),
                voucherNo: "11308",
                voucherType: "PAYMENT",
                sourceId: randomUUID(),
                branchId: BRANCH_ID,
                narration: "BEING TDS ON PURCHASE OF GOODS PAID FOR THE MONTH PF APRIL-25 VIDE CIN NO.: 0230001-07052025-03569",
                voucherDate: new Date("2025-05-06T18:30:00.000Z"),
                totalDebit: 183400,
                totalCredit: 183400,
                entries: {
                    create: [
                        { ledgerId: tdsGoods, branchId: BRANCH_ID, entryType: "DEBIT", amount: 183400, narration: "TDS ON PURCHASE OF GOODS April-25" },
                        { ledgerId: bankLedger.id, branchId: BRANCH_ID, entryType: "CREDIT", amount: 183400, narration: "TDS payment CIN 0230001-07052025-03569" }
                    ]
                }
            }
        });
        createdPayments += 1;
    }
    const existing11556 = await prisma.voucher.findFirst({
        where: { branchId: BRANCH_ID, voucherNo: "11556" },
        select: { id: true }
    });
    if (!existing11556 && tdsContract) {
        await prisma.voucher.create({
            data: {
                id: randomUUID(),
                voucherNo: "11556",
                voucherType: "PAYMENT",
                sourceId: randomUUID(),
                branchId: BRANCH_ID,
                narration: "BEING TDS ON CONTRACT SHORTFALL PAID OF MAR-25 VIDE CIN NO. : 0230001-22052025-00319",
                voucherDate: new Date("2025-05-21T18:30:00.000Z"),
                totalDebit: 89,
                totalCredit: 89,
                entries: {
                    create: [
                        { ledgerId: tdsContract, branchId: BRANCH_ID, entryType: "DEBIT", amount: 89, narration: "TDS ON CONTRACT shortfall Mar-25" },
                        { ledgerId: bankLedger.id, branchId: BRANCH_ID, entryType: "CREDIT", amount: 89, narration: "TDS payment CIN 0230001-22052025-00319" }
                    ]
                }
            }
        });
        createdPayments += 1;
    }

    console.log(JSON.stringify({ createdPurchases, createdSales, createdPayments, skipped, errors }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
