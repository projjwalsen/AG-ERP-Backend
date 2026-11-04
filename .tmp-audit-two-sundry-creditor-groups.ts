import "dotenv/config";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const SYSTEM = "ac2dc945-d13c-4116-ac64-a89f7ba5c1e2";
const CANON = "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) =>
    String(v ?? "")
        .normalize("NFKD")
        .replace(/\s*-\s*sundry\s+(?:debtor|creditor)s?\s*$/i, "")
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase();

(async () => {
    const groups = await prisma.ledgerGroup.findMany();
    const desc = (root: string) => {
        const ids = new Set([root]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
                ids.add(g.id); changed = true;
            }
        }
        return [...ids];
    };
    const load = async (root: string) => {
        const ledgers = await prisma.ledger.findMany({
            where: { branchId: BRANCH_ID, groupId: { in: desc(root) } },
            select: { id: true, name: true, category: true, groupId: true }
        });
        const entries: any[] = [];
        for (let i = 0; i < ledgers.length; i += 200) {
            entries.push(...await prisma.ledgerEntry.findMany({
                where: { ledgerId: { in: ledgers.slice(i, i + 200).map(l => l.id) } },
                select: {
                    id: true, ledgerId: true, entryType: true, amount: true, voucherId: true,
                    voucher: { select: { voucherType: true, voucherNo: true, voucherDate: true } }
                }
            }));
        }
        return { ledgers, entries };
    };
    const system = await load(SYSTEM);
    const canon = await load(CANON);
    const canonVouchers = new Set(canon.entries.map(e => e.voucherId));
    const canonEntryKeys = new Set(canon.entries.map(e =>
        `${e.voucherId}|${e.entryType}|${cents(e.amount)}|${norm(canon.ledgers.find(l => l.id === e.ledgerId)?.name)}`
    ));

    let sysOnly = 0, sysDup = 0, sysOnlyAmt = 0, sysDupAmt = 0;
    const sysOnlySamples: any[] = [];
    for (const e of system.entries) {
        const name = system.ledgers.find(l => l.id === e.ledgerId)?.name;
        const key = `${e.voucherId}|${e.entryType}|${cents(e.amount)}|${norm(name)}`;
        const amt = e.entryType === "DEBIT" ? cents(e.amount) : -cents(e.amount);
        if (canonVouchers.has(e.voucherId) || canonEntryKeys.has(key)) {
            sysDup += 1;
            sysDupAmt += amt;
        } else {
            sysOnly += 1;
            sysOnlyAmt += amt;
            if (sysOnlySamples.length < 15) {
                sysOnlySamples.push({
                    name, type: e.voucher.voucherType, no: e.voucher.voucherNo,
                    side: e.entryType, amount: Number(e.amount), voucherId: e.voucherId
                });
            }
        }
    }

    const sysNames = new Set(system.ledgers.map(l => norm(l.name)));
    const canonNames = new Set(canon.ledgers.map(l => norm(l.name)));
    const overlapNames = [...sysNames].filter(n => canonNames.has(n)).length;

    console.log(JSON.stringify({
        system: { ledgers: system.ledgers.length, entries: system.entries.length },
        canon: { ledgers: canon.ledgers.length, entries: canon.entries.length },
        overlapNames,
        systemOnlyNames: sysNames.size - overlapNames,
        canonOnlyNames: canonNames.size - overlapNames,
        systemEntriesAlsoInCanonVoucher: sysDup,
        systemEntriesNotInCanon: sysOnly,
        systemDupSigned: money(sysDupAmt),
        systemOnlySigned: money(sysOnlyAmt),
        sysOnlySamples
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
