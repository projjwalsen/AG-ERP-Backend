import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const NOS = ["IE-PDF-FACTORY-INS-PREPAID", "IE-PDF-INTERNET-PREPAID"];

(async () => {
    const insPdf = JSON.parse(fs.readFileSync(".tmp-pe-insurance.json", "utf8"));
    const expPdf = JSON.parse(fs.readFileSync(".tmp-pe-expenses.json", "utf8"));
    const vs = await prisma.voucher.findMany({
        where: { voucherNo: { in: NOS } },
        select: {
            id: true, voucherNo: true, voucherType: true,
            journals: { select: { id: true, status: true, amount: true, direction: true } },
            entries: {
                select: {
                    id: true, ledgerId: true, entryType: true, amount: true, narration: true,
                    ledger: { select: { name: true, group: { select: { name: true, parent: { select: { name: true } } } } } }
                }
            }
        }
    });
    console.log(JSON.stringify({
        insPdf: { n: insPdf.n, dr: insPdf.perDr, cr: insPdf.perCr, close: insPdf.closings },
        expPdf: { n: expPdf.n, dr: expPdf.perDr, cr: expPdf.perCr, close: expPdf.closings },
        extras: vs.map(v => ({
            id: v.id, no: v.voucherNo, type: v.voucherType, journals: v.journals,
            entries: v.entries.map(e => ({
                id: e.id, name: e.ledger.name,
                group: `${e.ledger.group?.parent?.name} > ${e.ledger.group?.name}`,
                side: e.entryType, amt: Number(e.amount)
            }))
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
