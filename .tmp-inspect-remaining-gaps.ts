import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);

(async () => {
    const plan = JSON.parse(fs.readFileSync(".tmp-reconcile-liability-heads-plan.json", "utf8"));
    const audit = JSON.parse(fs.readFileSync(".tmp-reconcile-liability-heads-audit.json", "utf8"));

    const skipNos = plan.skipRelink.map((x: any) => x.row.no);
    const extraNos = plan.unlink.map((x: any) => x.no);
    const createNos = plan.create.map((x: any) => x.no).filter((n: string) => !String(n).startsWith("RECON-"));
    const nos = [...new Set([...skipNos, ...extraNos, ...createNos])];
    const vouchers = await prisma.voucher.findMany({
        where: { branchId: "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb", voucherNo: { in: nos } },
        include: { entries: { include: { ledger: { include: { group: true } } } }, journals: true }
    });

    const dump = (wanted: string[]) => wanted.map(no => {
        const vs = vouchers.filter(v => v.voucherNo === no);
        return {
            no,
            vouchers: vs.map(v => ({
                id: v.id,
                type: v.voucherType,
                date: localDate(v.voucherDate),
                narration: v.narration,
                journals: v.journals.map(j => ({ sourceSheet: j.sourceSheet, serialNo: j.serialNo, voucherNo: j.voucherNo })),
                entries: v.entries.map(e => ({
                    ledger: e.ledger.name,
                    group: e.ledger.group.name,
                    groupId: e.ledger.groupId,
                    side: e.entryType,
                    amount: cents(e.amount) / 100
                }))
            }))
        };
    });

    const excelByNo = new Map<string, any[]>();
    for (const r of audit.unmatched as any[]) {
        const a = excelByNo.get(r.no) || [];
        a.push({ head: r.head, agency: r.agency, type: r.type, date: r.date, side: r.side, amount: r.cents / 100, particulars: r.particulars, row: r.row });
        excelByNo.set(r.no, a);
    }

    const extraExcel = plan.unlink.map((x: any) => ({
        extra: { ledger: x.ledger, no: x.no, type: x.type, date: x.date, amount: x.cents / 100 },
        excelSameNo: (audit.unmatched as any[]).filter((r: any) => r.no === x.no).map((r: any) => ({
            head: r.head, agency: r.agency, type: r.type, date: r.date, side: r.side, amount: r.cents / 100
        })),
        excelMatchedSameNo: null
    }));

    console.log(JSON.stringify({
        skipVouchers: dump(skipNos),
        extraVouchers: dump(extraNos),
        createVouchers: dump(createNos),
        extraExcel
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
