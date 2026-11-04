import "dotenv/config";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "fdd97fd1-f05b-4cce-8524-738751747f80";
const money = (v: unknown) => Number(Number(v || 0).toFixed(2));
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();

(async () => {
    const extract = JSON.parse(fs.readFileSync(".tmp-duties-excel-extract.json", "utf8"));
    const purchaseRows = extract.vouchers.filter((r: any) => r.type === "Purchase");
    const nos = [...new Set(purchaseRows.map((r: any) => String(r.no)))];
    const purchases = await prisma.purchase.findMany({
        where: { branchId: BRANCH_ID, invoiceNo: { in: nos as string[] } },
        select: {
            id: true, invoiceNo: true, invoiceDate: true, agencyId: true,
            subtotalAmount: true, roundOffAmount: true, grandTotal: true
        }
    });
    const existing = await prisma.voucher.findMany({
        where: { voucherType: "PURCHASE", sourceId: { in: purchases.map(p => p.id) } },
        select: { sourceId: true }
    });
    const has = new Set(existing.map(v => v.sourceId));
    const missingPurchases = purchases.filter(p => !has.has(p.id));

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
    const duties = await prisma.ledger.findMany({
        where: { groupId: { in: [...ids] } },
        select: { id: true, name: true, groupId: true }
    });
    const targetByName = new Map<string, string>();
    for (const l of duties) {
        const k = norm(l.name);
        const nested = pathOf(l.groupId).includes("Duties & Taxes > Duties & Taxes");
        if (!targetByName.has(k) || !nested) targetByName.set(k, l.id);
    }
    const purchaseLedger = await prisma.ledger.findFirst({
        where: { name: "Purchase - AG_ASHTAVINAYAKA_PETROCHEM_MH" }, select: { id: true }
    });
    const roundLedger = await prisma.ledger.findFirst({
        where: { name: "Round Off" }, select: { id: true }
    });
    const agencies = await prisma.agency.findMany({
        where: { id: { in: [...new Set(missingPurchases.map(p => p.agencyId))] } },
        select: { id: true, ledger: { select: { id: true, category: true } } }
    });

    let created = 0;
    const createdNos: string[] = [];
    for (const p of missingPurchases) {
        const vendor = agencies.find(a => a.id === p.agencyId)?.ledger.find(l => l.category === "VENDOR");
        if (!vendor || !purchaseLedger || !roundLedger) continue;
        const rows = purchaseRows.filter((r: any) => norm(r.no) === norm(p.invoiceNo));
        const entries: { ledgerId: string; entryType: "DEBIT" | "CREDIT"; amount: number; narration: string }[] = [];
        const sub = money(p.subtotalAmount);
        if (sub) entries.push({ ledgerId: purchaseLedger.id, entryType: "DEBIT", amount: sub, narration: `PURCHASE|${p.invoiceNo}` });
        for (const row of rows) {
            const target = targetByName.get(norm(row.name));
            if (!target) continue;
            entries.push({
                ledgerId: target, entryType: row.side, amount: money(row.amount),
                narration: String(row.narration || p.invoiceNo).slice(0, 400)
            });
        }
        const round = money(p.roundOffAmount);
        if (round > 0) entries.push({ ledgerId: roundLedger.id, entryType: "DEBIT", amount: round, narration: "Round Off" });
        if (round < 0) entries.push({ ledgerId: roundLedger.id, entryType: "CREDIT", amount: money(-round), narration: "Round Off" });
        entries.push({ ledgerId: vendor.id, entryType: "CREDIT", amount: money(p.grandTotal), narration: `PURCHASE|${p.invoiceNo}` });
        const dr = entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const cr = entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        if (dr !== cr) {
            entries.push({
                ledgerId: roundLedger.id,
                entryType: dr > cr ? "CREDIT" : "DEBIT",
                amount: money(Math.abs(dr - cr) / 100),
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
        created += 1;
        createdNos.push(p.invoiceNo);
    }
    console.log(JSON.stringify({ missingPurchases: missingPurchases.length, created, createdNos }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
