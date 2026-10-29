import "dotenv/config";
import * as XLSX from "xlsx";
import { prisma } from "./src/config/db";

const cents = (v: unknown) => Math.round(Number(String(v ?? "0").replace(/[,?\s]/g, "").replace(/[^0-9.-]/g, "")) * 100) || 0;
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

(async () => {
    const ids = [
        "651c94bf-13ba-47df-9f18-a100fdb9ab8c",
        "6c83b268-7266-4f70-b028-9b604afc5634",
        "fcb4906f-6d99-445f-b726-893c0d6cdb8f",
        "a9512666-9be0-4575-8e18-8a899ecdc7dd"
    ];
    const vouchers = await prisma.voucher.findMany({
        where: { id: { in: ids } },
        include: {
            entries: { include: { ledger: { include: { group: true } } } },
            transaction: true,
            journals: true,
            debitCreditNotes: true
        }
    });
    const rows = XLSX.utils.sheet_to_json<any[]>(
        XLSX.readFile("C:/Users/razon/Downloads/Advance_From_S_Debtors.xlsx").Sheets["Voucher Details"],
        { header: 1, defval: null, raw: false }
    ).slice(4).filter(r => String(r[1] || "").toLowerCase().includes("gauri"));
    const excel = rows.map((r, i) => ({
        row: i + 5,
        date: r[0],
        agency: r[1],
        type: r[2],
        no: r[3],
        particulars: r[4],
        debit: cents(r[5]) / 100,
        credit: cents(r[6]) / 100
    }));
    const oct27 = excel.filter(r => String(r.date).includes("27") && String(r.date).includes("10") || String(r.date).includes("2025-10-27"));
    console.log(JSON.stringify({
        vouchers: vouchers.map(v => ({
            id: v.id,
            no: v.voucherNo,
            type: v.voucherType,
            date: localDate(v.voucherDate),
            narration: v.narration,
            sourceId: v.sourceId,
            transactions: v.transaction.map(t => ({ id: t.id, no: (t as any).transactionNo, status: t.status })),
            journals: v.journals.length,
            notes: v.debitCreditNotes.length,
            entries: v.entries.map(e => ({
                ledger: e.ledger.name,
                group: e.ledger.group.name,
                side: e.entryType,
                amount: cents(e.amount) / 100
            }))
        })),
        gauriExcelCount: excel.length,
        gauriExcelCredits: excel.reduce((s, r) => s + r.credit, 0),
        gauriExcelDebits: excel.reduce((s, r) => s + r.debit, 0),
        oct27,
        sameAmountExcel: excel.filter(r => [10000000, 6000000, 500000].includes(r.credit) || [10000000, 6000000, 500000].includes(r.debit))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
