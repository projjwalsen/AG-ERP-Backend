import "dotenv/config";
import { prisma } from "./src/config/db";
import * as fs from "fs";

const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const LEDGERS: Record<string, string> = {
    AVNTIKA: "8f5d8517-fa62-4f14-bdd1-f54bcfaf4184",
    RAAJ: "44220c32-ec22-4606-9152-d06ece6af0ab",
    IOCL: "586b1d06-0ecb-404a-9f4a-b47a23430ea1",
    SIGMA_INACT: "fe6a98c9-f99e-411e-b296-43107459b463",
    SIGMA_ACT: "dc88369d-7d35-46aa-a513-000417098ff3",
    SILVER_INACT: "624ccc67-652b-4bf6-a9e3-35d66e7bd442",
    SILVER_ACT: "0078c46b-b562-464f-a227-6ad70c1e7a6f",
    CLASSIC_INACT: "3ca50cc3-79d7-4cc7-bc9f-083665765f6c",
    CLASSIC_ACT: "56374eba-3d95-4da9-a348-c95ae4b97880",
    DARSH_INACT: "6accb1c4-fa77-438b-9f0d-ac6144b2cb05",
    DARSH_ACT: "86d3c963-b177-4169-8228-07db9452a78c",
    GLOBAL_INACT: "02f03bb1-2bd6-42e2-8627-c9e75ab59642",
    GLOBAL_ACT: "8ce546c1-1871-4d6b-b637-4e7f32dece2d",
};

(async () => {
    const load = async (id: string, types?: string[]) => {
        return prisma.ledgerEntry.findMany({
            where: {
                ledgerId: id,
                voucher: {
                    voucherDate: { gte: START, lte: END },
                    voucherType: { not: "OPENING_BALANCE" },
                    ...(types ? { voucherType: { in: types as any } } : {})
                }
            },
            select: {
                id: true, entryType: true, amount: true, narration: true, voucherId: true,
                voucher: {
                    select: {
                        id: true, voucherNo: true, voucherType: true, voucherDate: true,
                        entries: {
                            select: {
                                id: true, ledgerId: true, entryType: true, amount: true,
                                ledger: { select: { name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } } }
                            }
                        }
                    }
                }
            }
        });
    };

    const summarize = (es: any[]) => es.map(e => ({
        id: e.id,
        no: e.voucher.voucherNo,
        type: e.voucher.voucherType,
        date: localDate(e.voucher.voucherDate),
        side: e.entryType,
        amt: Number(e.amount),
        narr: (e.narration || "").slice(0, 100),
        others: e.voucher.entries.filter((x: any) => x.id !== e.id).map((x: any) => ({
            name: x.ledger.name,
            cat: x.ledger.category,
            group: `${x.ledger.group?.parent?.name} > ${x.ledger.group?.name}`,
            side: x.entryType,
            amt: Number(x.amount)
        }))
    }));

    const avntikaP = summarize(await load(LEDGERS.AVNTIKA, ["PURCHASE"]));
    const raajP = summarize(await load(LEDGERS.RAAJ, ["PURCHASE"]));
    const ioclP = summarize(await load(LEDGERS.IOCL, ["PURCHASE"]));
    const ioclJ = summarize(await load(LEDGERS.IOCL, ["JOURNAL"]));
    const sigmaI = summarize(await load(LEDGERS.SIGMA_INACT));
    const sigmaA = summarize(await load(LEDGERS.SIGMA_ACT));
    const silverI = summarize(await load(LEDGERS.SILVER_INACT));
    const classicI = summarize(await load(LEDGERS.CLASSIC_INACT));
    const darshI = summarize(await load(LEDGERS.DARSH_INACT));
    const globalI = summarize(await load(LEDGERS.GLOBAL_INACT));
    const globalA = summarize(await load(LEDGERS.GLOBAL_ACT));

    // similar-name vendors
    const vendors = await prisma.ledger.findMany({
        where: {
            OR: [
                { name: { contains: "AVNTIKA", mode: "insensitive" } },
                { name: { contains: "RAAJ", mode: "insensitive" } },
                { name: { contains: "INDIAN OIL", mode: "insensitive" } },
                { name: { contains: "SIGMA PETRO", mode: "insensitive" } },
                { name: { contains: "SILVERBACK", mode: "insensitive" } },
                { name: { contains: "CLASSIC PETRO", mode: "insensitive" } },
                { name: { contains: "Darsh", mode: "insensitive" } },
                { name: { contains: "GLOBAL PLASTO", mode: "insensitive" } },
            ]
        },
        select: {
            id: true, name: true, category: true, isActive: true,
            group: { select: { name: true, parent: { select: { name: true } } } }
        }
    });

    const sigmaNeed = 17948743;
    const sigmaCombos: any[] = [];
    const sigmaCredits = sigmaI.filter(x => x.side === "CREDIT");
    // list all sigma inactive credits
    const silverNeed = 3515546;
    const silverCredits = silverI.filter(x => x.side === "CREDIT");

    const out = {
        avntikaP: { n: avntikaP.length, sum: money(avntikaP.reduce((s, x) => s + cents(x.amt), 0)), rows: avntikaP },
        raajP: { n: raajP.length, sum: money(raajP.reduce((s, x) => s + cents(x.amt), 0)), rows: raajP },
        ioclP: { n: ioclP.length, sum: money(ioclP.reduce((s, x) => s + cents(x.amt), 0)), rows: ioclP },
        ioclJcr: ioclJ.filter(x => x.side === "CREDIT"),
        sigmaI: sigmaI.map(x => ({ no: x.no, date: x.date, amt: x.amt, others: x.others.map((o: any) => `${o.side} ${o.name} ${o.amt}`) })),
        sigmaIsum: money(sigmaI.reduce((s, x) => s + cents(x.amt), 0)),
        silverI: silverI.map(x => ({ no: x.no, date: x.date, amt: x.amt })),
        classicI: classicI.map(x => ({ no: x.no, date: x.date, amt: x.amt, others: x.others.map((o: any) => `${o.side} ${o.name} ${o.amt}`) })),
        darshI: darshI.map(x => ({ no: x.no, date: x.date, amt: x.amt, others: x.others.map((o: any) => `${o.side} ${o.name} ${o.amt}`) })),
        globalI: globalI.map(x => ({ no: x.no, date: x.date, amt: x.amt })),
        vendors: vendors.map(v => ({ id: v.id, name: v.name, cat: v.category, active: v.isActive, group: `${v.group?.parent?.name} > ${v.group?.name}` }))
    };
    fs.writeFileSync(".tmp-advsc-purchases.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify({
        avntikaP: { n: out.avntikaP.n, sum: out.avntikaP.sum, rows: avntikaP.map(r => ({ no: r.no, amt: r.amt, others: r.others })) },
        raajP: { n: out.raajP.n, sum: out.raajP.sum, rows: raajP.map(r => ({ no: r.no, amt: r.amt, others: r.others })) },
        ioclP: { n: out.ioclP.n, sum: out.ioclP.sum, rows: ioclP.map(r => ({ no: r.no, amt: r.amt, others: r.others })) },
        ioclJcr: out.ioclJcr.map(r => ({ no: r.no, amt: r.amt, others: r.others })),
        sigmaI: out.sigmaI,
        silverI: out.silverI,
        classicI: out.classicI,
        darshI: out.darshI,
        globalI: out.globalI,
        vendors: out.vendors
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
