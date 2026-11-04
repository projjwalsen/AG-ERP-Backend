import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

(async () => {
    const miss = JSON.parse(fs.readFileSync(".tmp-rcm-compare.json", "utf8")).missing as any[];
    const nos = [...new Set(miss.map(m => m.no).filter((n: string) => n !== "233" && n !== "PDN/M/2526/030"))];
    const vs = await prisma.voucher.findMany({
        where: { branchId: BRANCH, voucherNo: { in: nos } },
        select: {
            id: true, voucherNo: true, voucherType: true, voucherDate: true,
            journals: { select: { id: true, status: true } },
            entries: { select: { ledger: { select: { name: true } }, entryType: true, amount: true } }
        }
    });
    const extra757 = await prisma.voucher.findMany({
        where: { voucherNo: "DUTIES-RCM-SGST-757" },
        select: {
            id: true, voucherNo: true,
            journals: { select: { id: true } },
            entries: { select: { id: true, ledger: { select: { name: true } }, entryType: true, amount: true } }
        }
    });
    const byNo: Record<string, number> = {};
    for (const v of vs) byNo[v.voucherNo] = (byNo[v.voucherNo] || 0) + 1;
    const multi = Object.entries(byNo).filter(([, n]) => n > 1);
    const noJournal = vs.filter(v => v.voucherType === "JOURNAL" && v.journals.filter(j => j.status === "APPROVED").length === 0);
    console.log(JSON.stringify({
        nos: nos.length, voucherHits: vs.length, multiN: multi.length, multiSample: multi.slice(0, 8),
        types: vs.reduce((m: any, v) => { m[v.voucherType] = (m[v.voucherType] || 0) + 1; return m; }, {}),
        journalWithoutApproved: noJournal.length,
        extra757,
        sampleHost: vs.filter(v => v.voucherNo === "338" || v.voucherNo === "AT/25-26/0105").map(v => ({
            no: v.voucherNo, type: v.voucherType, date: localDate(v.voucherDate),
            journals: v.journals.length, entries: v.entries.map(e => `${e.entryType} ${e.amount} ${e.ledger.name}`)
        }))
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
