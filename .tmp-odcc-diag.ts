import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const BOM_IDS = ["c1f62a06-f402-4b4c-a2b3-1dc3cb31c0b5", "8faa06f2-6b04-404e-8729-1cc3dd5d073b"];
const BOB_IDS = ["dc58112c-b8ea-4845-a598-c1cdffc44d6b", "9b5650be-5530-4401-8515-933dda455174"];
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

(async () => {
    const bomXl = JSON.parse(fs.readFileSync(".tmp-odcc-bom.json", "utf8"));
    const missDump = JSON.parse(fs.readFileSync(".tmp-odcc-bom-missing.json", "utf8"));

    const sampleNos = ["3", "4", "5", "10295", "10296", "10297", "18116", "11601", "11308", "11556-TDS-MAR25", "15423", "17188", "18044"];
    const samples = await prisma.ledgerEntry.findMany({
        where: {
            voucher: { branchId: BRANCH_ID, voucherNo: { in: sampleNos } }
        },
        select: {
            id: true, ledgerId: true, entryType: true, amount: true,
            ledger: { select: { id: true, name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } } },
            voucher: { select: { id: true, voucherNo: true, voucherType: true, voucherDate: true, narration: true } }
        },
        take: 80
    });

    const allNamed = await prisma.ledger.findMany({
        where: {
            OR: [
                { name: { contains: "60434886441", mode: "insensitive" } },
                { name: { contains: "13780500000078", mode: "insensitive" } },
                { name: { equals: "Bank Accounts", mode: "insensitive" } }
            ]
        },
        select: {
            id: true, name: true, category: true, nature: true, isActive: true, branchId: true,
            openingDebit: true, openingCredit: true,
            group: { select: { id: true, name: true, code: true, parent: { select: { name: true } } } }
        }
    });

    const openings = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: allNamed.map(l => l.id) },
            voucher: { voucherType: "OPENING_BALANCE" }
        },
        select: {
            id: true, ledgerId: true, entryType: true, amount: true,
            ledger: { select: { name: true } },
            voucher: { select: { id: true, voucherNo: true, voucherDate: true, narration: true, branchId: true } }
        }
    });

    const bomEntries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: BOM_IDS },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: {
            id: true, ledgerId: true, entryType: true, amount: true,
            voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } }
        }
    });

    const bomNos = new Set(bomEntries.map(e => norm(e.voucher.voucherNo)));
    const missing = missDump.missing as any[];
    const missingOnBomByNo = missing.filter(r => bomNos.has(norm(r.no))).slice(0, 15);
    const missNotOnBom = missing.filter(r => !bomNos.has(norm(r.no)));

    // Group missing voucher nos by whether they exist as vouchers
    const missNos = [...new Set(missNotOnBom.map(r => String(r.no)))].filter(Boolean);
    const missNoChunks: string[][] = [];
    for (let i = 0; i < Math.min(missNos.length, 400); i += 100) missNoChunks.push(missNos.slice(i, i + 100));

    const destCount: Record<string, { n: number; dr: number; cr: number; cat: string; group: string }> = {};
    const foundNos = new Set<string>();
    for (const chunk of missNoChunks) {
        const rows = await prisma.ledgerEntry.findMany({
            where: { voucher: { branchId: BRANCH_ID, voucherNo: { in: chunk } } },
            select: {
                entryType: true, amount: true,
                ledger: { select: { id: true, name: true, category: true, group: { select: { name: true } } } },
                voucher: { select: { voucherNo: true } }
            }
        });
        for (const e of rows) {
            foundNos.add(String(e.voucher.voucherNo));
            const key = e.ledger.name;
            destCount[key] = destCount[key] || { n: 0, dr: 0, cr: 0, cat: e.ledger.category, group: e.ledger.group?.name || "" };
            destCount[key].n += 1;
            if (e.entryType === "DEBIT") destCount[key].dr += cents(e.amount); else destCount[key].cr += cents(e.amount);
        }
    }

    // For missing receipts, find debit lines on BANK ledgers with matching voucherNo+amount
    const missReceipts = missNotOnBom.filter(r => r.side === "DEBIT");
    let relinkable = 0;
    let relinkDr = 0;
    const relinkByLedger: Record<string, { n: number; amt: number }> = {};
    const receiptChunks: string[][] = [];
    const recNos = [...new Set(missReceipts.map(r => String(r.no)))];
    for (let i = 0; i < recNos.length; i += 80) receiptChunks.push(recNos.slice(i, i + 80));
    const amountSet = new Set(missReceipts.map(r => cents(r.amount)));
    for (const chunk of receiptChunks) {
        const rows = await prisma.ledgerEntry.findMany({
            where: {
                entryType: "DEBIT",
                voucher: { branchId: BRANCH_ID, voucherNo: { in: chunk }, voucherType: { in: ["RECEIPT", "CONTRA", "PAYMENT", "JOURNAL"] } }
            },
            select: {
                id: true, amount: true, ledgerId: true,
                ledger: { select: { name: true, category: true, group: { select: { name: true } } } },
                voucher: { select: { voucherNo: true, voucherType: true } }
            }
        });
        for (const e of rows) {
            if (!amountSet.has(cents(e.amount))) continue;
            if (BOM_IDS.includes(e.ledgerId) || BOB_IDS.includes(e.ledgerId)) continue;
            relinkable += 1;
            relinkDr += cents(e.amount);
            const k = `${e.ledger.category}|${e.ledger.group?.name}|${e.ledger.name}`;
            relinkByLedger[k] = relinkByLedger[k] || { n: 0, amt: 0 };
            relinkByLedger[k].n += 1;
            relinkByLedger[k].amt += cents(e.amount);
        }
    }

    const extras = bomEntries.filter(e => (missDump.extraIds as string[]).includes(e.id));
    const extraDetail = extras.map(e => ({
        no: e.voucher.voucherNo, type: e.voucher.voucherType, date: localDate(e.voucher.voucherDate),
        side: e.entryType, amount: Number(e.amount)
    }));

    const v18116 = await prisma.voucher.findMany({
        where: { branchId: BRANCH_ID, voucherNo: { contains: "18116" } },
        select: {
            id: true, voucherNo: true, voucherType: true, voucherDate: true, narration: true,
            entries: { select: { entryType: true, amount: true, ledger: { select: { name: true, category: true, group: { select: { name: true } } } } } }
        },
        take: 10
    });

    const excelNoTypes = { string: 0, number: 0, other: 0 };
    for (const r of bomXl.vouchers.slice(0, 20)) {
        const t = typeof r.no;
        if (t === "string") excelNoTypes.string += 1;
        else if (t === "number") excelNoTypes.number += 1;
        else excelNoTypes.other += 1;
    }

    const bomNo3 = bomEntries.filter(e => norm(e.voucher.voucherNo) === "3" || String(e.voucher.voucherNo).includes("3"));
    const exact3 = bomEntries.filter(e => String(e.voucher.voucherNo) === "3");

    console.log(JSON.stringify({
        excelNoTypes,
        excelFirst3: bomXl.vouchers.slice(0, 3),
        namedLedgers: allNamed,
        openings: openings.map(e => ({
            ledger: e.ledger.name, ledgerId: e.ledgerId, side: e.entryType, amount: Number(e.amount),
            no: e.voucher.voucherNo, date: e.voucher.voucherDate, narration: (e.voucher.narration || "").slice(0, 180)
        })),
        missingTotal: missing.length,
        missingOnBomByNo: missingOnBomByNo.length,
        missingOnBomSample: missingOnBomByNo.slice(0, 5),
        missNotOnBom: missNotOnBom.length,
        destTop: Object.entries(destCount).sort((a, b) => b[1].n - a[1].n).slice(0, 15)
            .map(([k, v]) => ({ ledger: k, ...v, dr: money(v.dr), cr: money(v.cr) })),
        foundNosSample: missNoChunks[0]?.length, foundNos: foundNos.size,
        relinkable, relinkDr: money(relinkDr), relinkByLedger: Object.entries(relinkByLedger)
            .sort((a, b) => b[1].n - a[1].n).slice(0, 12)
            .map(([k, v]) => ({ k, n: v.n, amt: money(v.amt) })),
        extraDetail,
        exact3: exact3.map(e => ({ no: e.voucher.voucherNo, type: e.voucher.voucherType, date: localDate(e.voucher.voucherDate), side: e.entryType, amount: Number(e.amount) })),
        bomNo3sample: bomNo3.slice(0, 8).map(e => ({ no: JSON.stringify(e.voucher.voucherNo), type: e.voucher.voucherType, date: localDate(e.voucher.voucherDate), side: e.entryType, amount: Number(e.amount) })),
        samples: samples.map(e => ({
            no: JSON.stringify(e.voucher.voucherNo), type: e.voucher.voucherType, date: localDate(e.voucher.voucherDate),
            side: e.entryType, amount: Number(e.amount),
            ledger: e.ledger.name, cat: e.ledger.category, group: `${e.ledger.group?.parent?.name || ""} > ${e.ledger.group?.name}`
        })),
        v18116
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
