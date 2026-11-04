import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const money = (v: unknown) => Number(Number(v || 0).toFixed(2));
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();

const PAIRS = [
    { no: "AR/2526/0056", name: "INPUT IGST 18%", amount: 324417.6, side: "DEBIT" as const },
    { no: "16/2025-26", name: "INPUT IGST 18%", amount: 170426.7, side: "DEBIT" as const },
    { no: "PPI/2025-26/3419", name: "INPUT IGST 18%", amount: 265026.6, side: "DEBIT" as const },
    { no: "LI/GST/25-26/078", name: "INPUT CGST 9%", amount: 121010.4, side: "DEBIT" as const },
    { no: "LI/GST/25-26/078", name: "INPUT SGST 9%", amount: 121010.4, side: "DEBIT" as const },
    { no: "AIM/G2526/153", name: "INPUT CGST 9%", amount: 92716.92, side: "DEBIT" as const },
    { no: "AIM/G2526/153", name: "INPUT SGST 9%", amount: 92716.92, side: "DEBIT" as const },
    { no: "T/MH11/2526/0441", name: "INPUT CGST 9%", amount: 188041.52, side: "DEBIT" as const },
    { no: "T/MH11/2526/0441", name: "INPUT SGST 9%", amount: 188041.52, side: "DEBIT" as const },
];

(async () => {
    const groups = await prisma.ledgerGroup.findMany();
    const ids = new Set(["fdd97fd1-f05b-4cce-8524-738751747f80"]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
            ids.add(g.id); changed = true;
        }
    }
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
        where: { name: "Purchase - AG_ASHTAVINAYAKA_PETROCHEM_MH" },
        select: { id: true }
    });

    // Discover pair invoices from excel-unmatched's twins by searching purchases with same GST amount.
    const missNos = [
        "AR/2526/0056", "16/2025-26", "PPI/2025-26/3419", "LI/GST/25-26/078",
        "AIM/G2526/153", "AIM/G2526/155", "T/MH11/2526/0441", "T/MH11/2526/0443",
        "SGT/25-26/279", "SGT/25-26/281", "SGT/25-26/320", "SGT/25-26/322",
        "LI/GST/25-26/333", "LI/GST/25-26/335", "T/MH11/2526/0775", "T/MH11/2526/0777"
    ];
    const purchases = await prisma.purchase.findMany({
        where: { branchId: BRANCH_ID, invoiceNo: { in: missNos } },
        select: {
            id: true, invoiceNo: true, invoiceDate: true, agencyId: true,
            subtotalAmount: true, roundOffAmount: true, grandTotal: true,
            totalIGSTAmount: true, totalCGSTAmount: true, totalSGSTAmount: true
        }
    });
    const vouchers = purchases.length ? await prisma.voucher.findMany({
        where: { voucherType: "PURCHASE", sourceId: { in: purchases.map(p => p.id) } },
        select: {
            id: true, sourceId: true, voucherNo: true,
            entries: { select: { id: true, ledgerId: true, entryType: true, amount: true, ledger: { select: { name: true } } } }
        }
    }) : [];

    const found = purchases.map(p => {
        const v = vouchers.find(x => x.sourceId === p.id);
        return {
            no: p.invoiceNo, igst: money(p.totalIGSTAmount), cgst: money(p.totalCGSTAmount), sgst: money(p.totalSGSTAmount),
            hasVoucher: Boolean(v),
            gstEntries: v?.entries.filter(e => /GST|IGST|CGST|SGST/i.test(e.ledger.name)).map(e => `${e.entryType} ${e.amount} ${e.ledger.name}`)
        };
    });

    // Broader: all purchases whose invoice is like the unmatched ones minus last digit / nearby
    const allUnmatched = ["AR/2526/0056", "16/2025-26", "PPI/2025-26/3419", "LI/GST/25-26/078"];
    const extra = await prisma.purchase.findMany({
        where: {
            branchId: BRANCH_ID,
            OR: [
                { invoiceNo: { startsWith: "AR/2526/005" } },
                { invoiceNo: { in: ["16/2025-26", "17/2025-26", "15/2025-26"] } },
                { invoiceNo: { startsWith: "PPI/2025-26/341" } },
                { invoiceNo: { startsWith: "LI/GST/25-26/07" } }
            ]
        },
        select: { id: true, invoiceNo: true, totalIGSTAmount: true, totalCGSTAmount: true, totalSGSTAmount: true }
    });
    const extraV = extra.length ? await prisma.voucher.findMany({
        where: { voucherType: "PURCHASE", sourceId: { in: extra.map(p => p.id) } },
        select: { sourceId: true, voucherNo: true, entries: { select: { amount: true, entryType: true, ledger: { select: { name: true } } } } }
    }) : [];

    console.log(JSON.stringify({
        found,
        nearby: extra.map(p => {
            const v = extraV.find(x => x.sourceId === p.id);
            return {
                no: p.invoiceNo, igst: money(p.totalIGSTAmount), cgst: money(p.totalCGSTAmount),
                voucher: v?.voucherNo,
                gst: v?.entries.filter(e => /INPUT /i.test(e.ledger.name)).map(e => `${e.entryType} ${e.amount} ${e.ledger.name}`)
            };
        })
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
