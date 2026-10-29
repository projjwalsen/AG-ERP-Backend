import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();

(async () => {
    const plan = JSON.parse(fs.readFileSync(".tmp-odcc-relink-plan.json", "utf8"));
    const still = plan.stillMissing as any[];
    const extras = plan.extra as any[];

    const stillNos = [...new Set(still.map(r => String(r.no)))];
    const vouchers = [];
    for (let i = 0; i < stillNos.length; i += 80) {
        const chunk = stillNos.slice(i, i + 80);
        const rows = await prisma.voucher.findMany({
            where: { branchId: BRANCH_ID, voucherNo: { in: chunk } },
            select: {
                id: true, voucherNo: true, voucherType: true, voucherDate: true, narration: true,
                totalDebit: true, totalCredit: true,
                entries: { select: { entryType: true, amount: true, ledger: { select: { name: true, category: true, group: { select: { name: true } } } } } },
                journals: { select: { id: true, amount: true, direction: true, remarks: true, journalHead: { select: { name: true, ledger: { select: { name: true } } } } } }
            }
        });
        vouchers.push(...rows);
    }

    const vByNo = new Map<string, any[]>();
    for (const v of vouchers) {
        const k = String(v.voucherNo);
        vByNo.set(k, [...(vByNo.get(k) || []), v]);
    }

    const classified = { noVoucher: 0, unbalanced: 0, balancedNoBom: 0, hasBom: 0, journalOnly: 0 };
    const samples: any = { noVoucher: [], unbalanced: [], balancedNoBom: [], hasBom: [] };
    for (const row of still) {
        const vs = vByNo.get(String(row.no)) || [];
        if (!vs.length) {
            classified.noVoucher += 1;
            if (samples.noVoucher.length < 8) samples.noVoucher.push(row);
            continue;
        }
        const sameAmt = vs.filter(v =>
            v.entries.some((e: any) => cents(e.amount) === cents(row.amount))
        );
        const pick = sameAmt[0] || vs[0];
        const dr = pick.entries.filter((e: any) => e.entryType === "DEBIT").reduce((s: number, e: any) => s + cents(e.amount), 0);
        const cr = pick.entries.filter((e: any) => e.entryType === "CREDIT").reduce((s: number, e: any) => s + cents(e.amount), 0);
        const hasBom = pick.entries.some((e: any) => /60434886441|13780500000078/i.test(e.ledger.name));
        const bucket = hasBom ? "hasBom" : (dr !== cr ? "unbalanced" : "balancedNoBom");
        classified[bucket] += 1;
        if (samples[bucket].length < 6) {
            samples[bucket].push({
                excel: row,
                voucher: {
                    no: pick.voucherNo, type: pick.voucherType, date: localDate(pick.voucherDate),
                    totDr: Number(pick.totalDebit), totCr: Number(pick.totalCredit),
                    narr: (pick.narration || "").slice(0, 80),
                    entries: pick.entries.map((e: any) => ({
                        side: e.entryType, amount: Number(e.amount), name: e.ledger.name, cat: e.ledger.category, group: e.ledger.group?.name
                    })),
                    journals: pick.journals.slice(0, 4)
                }
            });
        }
    }

    // Journals with voucherNo matching still-missing, no voucher
    const jNos = still.filter((_, i) => true).map(r => String(r.no)).slice(0, 80);
    const journals = await prisma.journal.findMany({
        where: { branchId: BRANCH_ID, voucherNo: { in: stillNos.slice(0, 120) } },
        select: {
            id: true, voucherNo: true, voucherId: true, amount: true, direction: true, journalDate: true, remarks: true, status: true,
            journalHead: { select: { name: true, ledger: { select: { id: true, name: true } } } }
        },
        take: 40
    });

    // Extra vouchers
    const extraNos = extras.map((h: any) => h.no);
    const extraVouchers = await prisma.voucher.findMany({
        where: { branchId: BRANCH_ID, voucherNo: { in: extraNos } },
        select: {
            voucherNo: true, voucherType: true, voucherDate: true, narration: true, totalDebit: true, totalCredit: true,
            entries: { select: { id: true, entryType: true, amount: true, ledgerId: true, ledger: { select: { name: true, category: true, group: { select: { name: true } } } } } }
        }
    });

    // Bank Charges 1.80 entries around still-missing dates
    const bankCharge18 = await prisma.ledgerEntry.findMany({
        where: {
            amount: 1.8,
            entryType: "DEBIT",
            ledger: { name: { contains: "Bank Charges", mode: "insensitive" } },
            voucher: { branchId: BRANCH_ID, voucherNo: { in: stillNos.slice(0, 50) } }
        },
        select: {
            id: true, amount: true,
            voucher: {
                select: {
                    voucherNo: true, voucherType: true, voucherDate: true, totalDebit: true, totalCredit: true,
                    entries: { select: { entryType: true, amount: true, ledger: { select: { name: true } } } }
                }
            }
        },
        take: 15
    });

    const stillParticulars: Record<string, { n: number; amt: number }> = {};
    for (const r of still) {
        const k = String(r.particular || "").slice(0, 60);
        stillParticulars[k] = stillParticulars[k] || { n: 0, amt: 0 };
        stillParticulars[k].n += 1;
        stillParticulars[k].amt += r.amount;
    }

    console.log(JSON.stringify({
        still: still.length,
        classified,
        samples,
        journalsSample: journals.slice(0, 12),
        extraVouchers: extraVouchers.map(v => ({
            no: v.voucherNo, type: v.voucherType, date: localDate(v.voucherDate),
            totDr: Number(v.totalDebit), totCr: Number(v.totalCredit),
            narr: (v.narration || "").slice(0, 90),
            entries: v.entries.map(e => ({ id: e.id, side: e.entryType, amount: Number(e.amount), name: e.ledger.name, cat: e.ledger.category, group: e.ledger.group?.name }))
        })),
        bankCharge18: bankCharge18.map(e => ({
            no: e.voucher.voucherNo, type: e.voucher.voucherType, date: localDate(e.voucher.voucherDate),
            totDr: Number(e.voucher.totalDebit), totCr: Number(e.voucher.totalCredit),
            entries: e.voucher.entries
        })),
        stillParticulars: Object.entries(stillParticulars).sort((a, b) => b[1].n - a[1].n).slice(0, 20)
            .map(([k, v]) => ({ k, n: v.n, amt: v.amt }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
