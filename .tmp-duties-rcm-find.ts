import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const ROOT = "fdd97fd1-f05b-4cce-8524-738751747f80";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();

(async () => {
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            amount: 1974.23,
            voucher: { branchId: BRANCH_ID, voucherDate: { gte: START, lte: END } }
        },
        select: {
            id: true, entryType: true, amount: true, narration: true,
            ledger: { select: { name: true, group: { select: { name: true } } } },
            voucher: { select: { id: true, voucherNo: true, voucherType: true, narration: true, voucherDate: true } }
        }
    });

    const groups = await prisma.ledgerGroup.findMany();
    const ids = new Set([ROOT]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
            ids.add(g.id); changed = true;
        }
    }
    const ledgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...ids] } },
        select: { id: true, name: true }
    });
    const byName = (n: string) => ledgers.find(l => norm(l.name) === norm(n));
    const targets = {
        "INPUT RCM CGST": byName("INPUT RCM CGST"),
        "INPUT RCM SGST": byName("INPUT RCM SGST"),
        "OUTPUT RCM CGST": byName("OUTPUT RCM CGST"),
        "OUTPUT RCM SGST": byName("OUTPUT RCM SGST")
    };

    let created = null;
    if (entries.length === 0) {
        const t = Object.values(targets);
        if (t.every(Boolean)) {
            const voucher = await prisma.voucher.create({
                data: {
                    id: randomUUID(),
                    voucherNo: "233-RCM-APM-R2526-0001",
                    voucherType: "JOURNAL",
                    sourceId: randomUUID(),
                    branchId: BRANCH_ID,
                    narration: "BEING: 5% RCM BOOKED AGST INVOICE NO. APM/R2526/0001 DATED: 01.04.2025 FOR SKG TRANSPORT SERVICES",
                    voucherDate: new Date("2025-03-31T18:30:00.000Z"),
                    totalDebit: 3948.46,
                    totalCredit: 3948.46,
                    entries: {
                        create: [
                            { ledgerId: targets["INPUT RCM CGST"]!.id, branchId: BRANCH_ID, entryType: "DEBIT", amount: 1974.23, narration: "RCM CGST SKG TRANSPORT" },
                            { ledgerId: targets["INPUT RCM SGST"]!.id, branchId: BRANCH_ID, entryType: "DEBIT", amount: 1974.23, narration: "RCM SGST SKG TRANSPORT" },
                            { ledgerId: targets["OUTPUT RCM CGST"]!.id, branchId: BRANCH_ID, entryType: "CREDIT", amount: 1974.23, narration: "RCM CGST SKG TRANSPORT" },
                            { ledgerId: targets["OUTPUT RCM SGST"]!.id, branchId: BRANCH_ID, entryType: "CREDIT", amount: 1974.23, narration: "RCM SGST SKG TRANSPORT" }
                        ]
                    }
                }
            });
            created = voucher.id;
        }
    }

    console.log(JSON.stringify({
        hits: entries.map(e => ({
            side: e.entryType, amount: Number(e.amount), ledger: e.ledger.name, group: e.ledger.group.name,
            no: e.voucher.voucherNo, type: e.voucher.voucherType, date: e.voucher.voucherDate,
            narration: (e.narration || e.voucher.narration || "").slice(0, 160)
        })),
        targets: Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, v?.id])),
        created
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
