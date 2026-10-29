import "dotenv/config";
import { prisma } from "./src/config/db";

(async () => {
    const sales = await prisma.sale.findMany({
        where: { invoiceNo: { in: ["APM/G2526/0001", "APM/G2526/0002", "APM/G2526/0420"] } },
        select: { id: true, invoiceNo: true, invoiceDate: true, totalCGSTAmount: true, totalSGSTAmount: true, totalIGSTAmount: true }
    });
    const vouchers = await prisma.voucher.findMany({
        where: { sourceId: { in: sales.map(s => s.id) } },
        select: {
            voucherNo: true, voucherType: true, sourceId: true,
            entries: { select: { entryType: true, amount: true, ledger: { select: { name: true, category: true } } } }
        }
    });
    const byNo = await prisma.voucher.findMany({
        where: { voucherNo: { in: ["APM/G2526/0001", "APM/G2526/0002", "APM/G2526/0420"] } },
        select: { voucherNo: true, voucherType: true }
    });
    console.log(JSON.stringify({ sales, vouchers, byNo }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
