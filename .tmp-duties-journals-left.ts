import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const ROOT = "fdd97fd1-f05b-4cce-8524-738751747f80";
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();

(async () => {
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
        select: { id: true, name: true, group: { select: { name: true, parentId: true } } }
    });
    const byName = (name: string) => {
        const n = norm(name);
        const opts = ledgers.filter(l => norm(l.name) === n);
        return opts.find(l => l.group.name !== "Duties & Taxes" || true) || opts[0];
    };

    const v2379 = await prisma.voucher.findMany({
        where: {
            branchId: BRANCH_ID,
            voucherNo: { in: ["2379", "233"] },
            voucherDate: { gte: START, lte: END }
        },
        select: {
            id: true, voucherNo: true, voucherType: true, narration: true, voucherDate: true,
            entries: { select: { entryType: true, amount: true, ledger: { select: { name: true } } } }
        }
    });

    const rcmInvoice = await prisma.voucher.findMany({
        where: {
            branchId: BRANCH_ID,
            OR: [
                { voucherNo: { contains: "APM/R2526/0001", mode: "insensitive" } },
                { narration: { contains: "APM/R2526/0001", mode: "insensitive" } },
                { narration: { contains: "5% RCM BOOKED", mode: "insensitive" } },
                { entries: { some: { narration: { contains: "RCM BOOKED", mode: "insensitive" } } } }
            ]
        },
        select: {
            id: true, voucherNo: true, voucherType: true, narration: true,
            entries: { select: { id: true, entryType: true, amount: true, ledger: { select: { name: true } } } }
        }
    });

    const salesRcm = await prisma.sale.findMany({
        where: { branchId: BRANCH_ID, invoiceNo: { contains: "R2526/0001" } },
        select: { id: true, invoiceNo: true, invoiceDate: true }
    });

    const inputIgst = byName("INPUT IGST 18%");
    const itc = byName("IGST ITC Not Reflected in GSTR-2B");
    const inRcmC = byName("INPUT RCM CGST");
    const inRcmS = byName("INPUT RCM SGST");
    const outRcmC = byName("OUTPUT RCM CGST");
    const outRcmS = byName("OUTPUT RCM SGST");

    const created: string[] = [];
    if (inputIgst && itc && !v2379.some(v => v.voucherNo === "2379")) {
        await prisma.voucher.create({
            data: {
                id: randomUUID(),
                voucherNo: "2379",
                voucherType: "JOURNAL",
                sourceId: randomUUID(),
                branchId: BRANCH_ID,
                narration: "BEING ITC RELATED OF APPA ELECTRICAL HARDWARE & AVALANCE REFINERIES PVT LTD RELATED TO JULY-25 REFELECTED IN AUG-25 GSTR-2B HENCE CLAIMED THE SAME",
                voucherDate: new Date("2025-08-30T18:30:00.000Z"),
                totalDebit: 401760,
                totalCredit: 401760,
                entries: {
                    create: [
                        { ledgerId: inputIgst.id, branchId: BRANCH_ID, entryType: "DEBIT", amount: 401760, narration: "ITC claimed GSTR-2B Aug-25" },
                        { ledgerId: itc.id, branchId: BRANCH_ID, entryType: "CREDIT", amount: 401760, narration: "ITC claimed GSTR-2B Aug-25" }
                    ]
                }
            }
        });
        created.push("2379");
    }

    if (inRcmC && inRcmS && outRcmC && outRcmS && !v2379.some(v => v.voucherNo === "233" && v.entries.some(e => /RCM/i.test(e.ledger.name)))) {
        const existing233 = v2379.find(v => v.voucherNo === "233");
        if (!existing233) {
            await prisma.voucher.create({
                data: {
                    id: randomUUID(),
                    voucherNo: "233",
                    voucherType: "JOURNAL",
                    sourceId: randomUUID(),
                    branchId: BRANCH_ID,
                    narration: "BEING: 5% RCM BOOKED AGST INVOICE NO. APM/R2526/0001 DATED: 01.04.2025 FOR SKG TRANSPORT SERVICES",
                    voucherDate: new Date("2025-03-31T18:30:00.000Z"),
                    totalDebit: 3948.46,
                    totalCredit: 3948.46,
                    entries: {
                        create: [
                            { ledgerId: inRcmC.id, branchId: BRANCH_ID, entryType: "DEBIT", amount: 1974.23, narration: "RCM CGST SKG TRANSPORT APM/R2526/0001" },
                            { ledgerId: inRcmS.id, branchId: BRANCH_ID, entryType: "DEBIT", amount: 1974.23, narration: "RCM SGST SKG TRANSPORT APM/R2526/0001" },
                            { ledgerId: outRcmC.id, branchId: BRANCH_ID, entryType: "CREDIT", amount: 1974.23, narration: "RCM CGST SKG TRANSPORT APM/R2526/0001" },
                            { ledgerId: outRcmS.id, branchId: BRANCH_ID, entryType: "CREDIT", amount: 1974.23, narration: "RCM SGST SKG TRANSPORT APM/R2526/0001" }
                        ]
                    }
                }
            });
            created.push("233");
        }
    }

    console.log(JSON.stringify({
        existingVouchers: v2379.map(v => ({
            no: v.voucherNo, type: v.voucherType, date: v.voucherDate,
            narration: (v.narration || "").slice(0, 120),
            entries: v.entries.map(e => `${e.entryType} ${e.amount} ${e.ledger.name}`)
        })),
        rcmInvoice: rcmInvoice.map(v => ({
            no: v.voucherNo, type: v.voucherType,
            narration: (v.narration || "").slice(0, 120),
            entries: v.entries.map(e => `${e.entryType} ${e.amount} ${e.ledger.name}`)
        })),
        salesRcm,
        targets: {
            inputIgst: inputIgst?.id, itc: itc?.id,
            inRcmC: inRcmC?.id, inRcmS: inRcmS?.id, outRcmC: outRcmC?.id, outRcmS: outRcmS?.id
        },
        created
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
