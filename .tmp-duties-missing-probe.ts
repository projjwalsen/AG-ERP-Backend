import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const norm = (v: unknown) => String(v || "").replace(/_x000D_/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
const money = (v: unknown) => Number(Number(v || 0).toFixed(2));

(async () => {
    const backup = JSON.parse(fs.readFileSync(".tmp-duties-recon-backup.json", "utf8"));
    const missing = backup.stillMissing as any[];
    const nos = [...new Set(missing.map(r => String(r.no || "")))];
    const sampleNos = [
        "PDN/M/2526/003", "PCN/M/2526/001", "SDN/M/2526/001", "SCN/M/2526/001",
        "SAS/25-26-006", "ARGJ/25-26/0121", "APM/G2526/0433", "233",
        "PDN/M/2526/014", "SDN/M/2526/004"
    ];

    const notes = await prisma.debitCreditNote.findMany({
        where: { branchId: BRANCH_ID },
        select: {
            id: true, noteNo: true, type: true, sourceType: true, status: true,
            voucherId: true, categoryPath: true, cgstAmount: true, sgstAmount: true,
            igstAmount: true, totalAmount: true, purchaseId: true, saleId: true
        }
    });
    const notesByNo = new Map<string, typeof notes>();
    for (const n of notes) {
        const k = norm(n.noteNo);
        notesByNo.set(k, [...(notesByNo.get(k) || []), n]);
    }

    const sales = await prisma.sale.findMany({
        where: { branchId: BRANCH_ID, invoiceNo: { in: nos } },
        select: { id: true, invoiceNo: true, tcsAmount: true, totalCGSTAmount: true, totalSGSTAmount: true, totalIGSTAmount: true }
    });
    const purchases = await prisma.purchase.findMany({
        where: { branchId: BRANCH_ID, invoiceNo: { in: nos } },
        select: { id: true, invoiceNo: true }
    });

    const inspect = async (no: string) => {
        const noteHits = notesByNo.get(norm(no)) || [];
        const saleHits = sales.filter(s => norm(s.invoiceNo) === norm(no));
        const purchaseHits = purchases.filter(p => norm(p.invoiceNo) === norm(no));
        const voucherIds = [
            ...noteHits.map(n => n.voucherId).filter(Boolean),
            ...await prisma.voucher.findMany({
                where: {
                    branchId: BRANCH_ID,
                    OR: [
                        { voucherNo: { contains: no, mode: "insensitive" } },
                        { sourceId: { in: [...saleHits.map(s => s.id), ...purchaseHits.map(p => p.id), ...noteHits.map(n => n.id)] } }
                    ]
                },
                select: { id: true }
            }).then(vs => vs.map(v => v.id))
        ];
        const uniqueVoucherIds = [...new Set(voucherIds.filter(Boolean) as string[])];
        const vouchers = uniqueVoucherIds.length
            ? await prisma.voucher.findMany({
                where: { id: { in: uniqueVoucherIds } },
                select: {
                    id: true, voucherNo: true, voucherType: true, voucherDate: true, narration: true,
                    entries: {
                        select: {
                            id: true, entryType: true, amount: true,
                            ledger: { select: { name: true, category: true, group: { select: { name: true } } } }
                        }
                    }
                }
            })
            : [];
        const excel = missing.filter(r => String(r.no) === no).map(r => ({
            name: r.name, side: r.side, amount: r.amount, type: r.type, date: r.date
        }));
        return {
            no,
            excel,
            notes: noteHits.map(n => ({
                noteNo: n.noteNo, type: n.type, sourceType: n.sourceType, status: n.status,
                voucherId: n.voucherId, categoryPath: n.categoryPath,
                cgst: money(n.cgstAmount), sgst: money(n.sgstAmount), igst: money(n.igstAmount),
                total: money(n.totalAmount), purchaseId: n.purchaseId, saleId: n.saleId
            })),
            sales: saleHits,
            purchases: purchaseHits,
            vouchers: vouchers.map(v => ({
                voucherNo: v.voucherNo, type: v.voucherType, date: v.voucherDate,
                narration: (v.narration || "").slice(0, 120),
                entries: v.entries.map(e => ({
                    side: e.entryType, amount: money(e.amount),
                    ledger: e.ledger.name, category: e.ledger.category, group: e.ledger.group?.name
                }))
            }))
        };
    };

    const samples = [];
    for (const no of sampleNos) samples.push(await inspect(no));

    const missingNos = [...new Set(missing.map(r => String(r.no)))];
    let notesFound = 0, notesNoVoucher = 0, salesFound = 0, purchasesFound = 0, none = 0;
    for (const no of missingNos) {
        const n = notesByNo.get(norm(no)) || [];
        const s = sales.filter(x => norm(x.invoiceNo) === norm(no));
        const p = purchases.filter(x => norm(x.invoiceNo) === norm(no));
        if (n.length) {
            notesFound += 1;
            if (n.every(x => !x.voucherId)) notesNoVoucher += 1;
        } else if (s.length) salesFound += 1;
        else if (p.length) purchasesFound += 1;
        else none += 1;
    }

    const tcsLedger = await prisma.ledger.findMany({
        where: { name: { contains: "TCS ON SALE OF SCRAP", mode: "insensitive" } },
        select: { id: true, name: true, group: { select: { name: true } } }
    });
    const itcLedger = await prisma.ledger.findMany({
        where: { name: { contains: "IGST ITC Not Reflected", mode: "insensitive" } },
        select: { id: true, name: true, group: { select: { name: true } } }
    });

    fs.writeFileSync(".tmp-duties-missing-probe.json", JSON.stringify({
        missingRows: missing.length,
        missingNos: missingNos.length,
        coverage: { notesFound, notesNoVoucher, salesFound, purchasesFound, none },
        tcsLedger, itcLedger,
        samples
    }, null, 2));
    console.log(JSON.stringify({
        missingRows: missing.length,
        missingNos: missingNos.length,
        coverage: { notesFound, notesNoVoucher, salesFound, purchasesFound, none },
        tcsLedger, itcLedger,
        sampleSummary: samples.map(s => ({
            no: s.no,
            excel: s.excel.length,
            notes: s.notes.length,
            sales: s.sales.length,
            purchases: s.purchases.length,
            vouchers: s.vouchers.length,
            entries: s.vouchers.flatMap(v => v.entries).map(e => `${e.side} ${e.amount} ${e.ledger}`)
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
