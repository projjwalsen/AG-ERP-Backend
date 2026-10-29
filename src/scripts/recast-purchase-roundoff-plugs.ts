import "dotenv/config";
import { EntryType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const money = (value: number) => Number(value.toFixed(2));
const FY_START = new Date("2025-03-31T18:30:00.000Z");
const FY_END = new Date("2026-03-31T18:29:59.999Z");
const apply = process.argv.includes("--apply");

async function main() {
    const roundOffLedgers = await prisma.ledger.findMany({
        where: { name: "Round Off" },
        select: { id: true, name: true }
    });
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: roundOffLedgers.map(l => l.id) },
            amount: { gt: 1000 },
            voucher: { voucherDate: { gte: FY_START, lte: FY_END }, voucherType: "PURCHASE" }
        },
        select: {
            id: true,
            ledgerId: true,
            amount: true,
            entryType: true,
            voucher: {
                select: {
                    id: true,
                    voucherNo: true,
                    entries: {
                        select: {
                            ledgerId: true,
                            ledger: { select: { name: true, category: true } }
                        }
                    }
                }
            }
        }
    });
    const recasts = entries.map(e => {
        const purchase = e.voucher.entries.find(x =>
            x.ledger.category === "PURCHASE" || /^purchase/i.test(x.ledger.name)
        );
        return {
            entryId: e.id,
            fromLedgerId: e.ledgerId,
            toLedgerId: purchase?.ledgerId || "",
            toLedger: purchase?.ledger.name || "",
            voucherNo: e.voucher.voucherNo,
            signed: e.entryType === EntryType.DEBIT ? Number(e.amount) : -Number(e.amount)
        };
    });
    const missing = recasts.filter(r => !r.toLedgerId);
    console.log(JSON.stringify({
        dryRun: !apply,
        count: recasts.length,
        net: money(recasts.reduce((s, r) => s + r.signed, 0)),
        missing: missing.length,
        rows: recasts.map(r => ({ voucherNo: r.voucherNo, toLedger: r.toLedger, signed: money(r.signed) }))
    }, null, 2));
    if (!apply || missing.length) return;
    const touched = new Set<string>();
    for (const row of recasts) {
        await prisma.ledgerEntry.update({
            where: { id: row.entryId },
            data: { ledgerId: row.toLedgerId, narration: "Recast from Round Off plug to Purchase" }
        });
        touched.add(row.fromLedgerId);
        touched.add(row.toLedgerId);
    }
    for (const ledgerId of touched) await LedgerService.syncCachedBalance(prisma, ledgerId);
    console.log(JSON.stringify({ recast: recasts.length, synced: touched.size }));
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
