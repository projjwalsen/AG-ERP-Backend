import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) =>
    String(v ?? "")
        .normalize("NFKD")
        .replace(/\s*-\s*sundry\s+(?:debtor|creditor)s?\s*$/i, "")
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase();

(async () => {
    const tally = JSON.parse(fs.readFileSync("C:/Users/razon/Downloads/SCREDITORS.json", "utf8")) as any[];
    const skip = /^(particulars|grand total|sundry creditors|a g ashtavinayaka|cin:|e-mail|group summary|1-apr|khopoli|survey)/i;
    const tallyRows = tally
        .map(r => ({
            name: String(r["A G Ashtavinayaka Petrochem Pvt Ltd - Maharashtra"] || "").trim(),
            open: cents(r.col),
            debit: cents(r.col_2),
            credit: cents(r.col_3),
            close: cents(r.col_4)
        }))
        .filter(r => r.name && !skip.test(r.name));

    const groups = await prisma.ledgerGroup.findMany();
    const ids = new Set([ROOT]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
            ids.add(g.id);
            changed = true;
        }
    }
    const ledgers = await prisma.ledger.findMany({
        where: { branchId: BRANCH_ID, groupId: { in: [...ids] } },
        select: { id: true, name: true }
    });
    const entries: any[] = [];
    for (let i = 0; i < ledgers.length; i += 200) {
        entries.push(...await prisma.ledgerEntry.findMany({
            where: { ledgerId: { in: ledgers.slice(i, i + 200).map(l => l.id) } },
            include: { voucher: { select: { voucherType: true } } }
        }));
    }
    const byName = new Map<string, { name: string; openDr: number; openCr: number; debit: number; credit: number }>();
    const ledgerName = new Map(ledgers.map(l => [l.id, l.name]));
    for (const e of entries) {
        const name = ledgerName.get(e.ledgerId) || "";
        const key = norm(name);
        const row = byName.get(key) || { name, openDr: 0, openCr: 0, debit: 0, credit: 0 };
        const amount = cents(e.amount);
        if (e.voucher.voucherType === "OPENING_BALANCE") {
            if (e.entryType === "DEBIT") row.openDr += amount;
            else row.openCr += amount;
        } else if (e.entryType === "DEBIT") row.debit += amount;
        else row.credit += amount;
        byName.set(key, row);
    }

    const mismatches: any[] = [];
    const missingInDb: any[] = [];
    const extraInDb: any[] = [];
    const used = new Set<string>();
    let tOpen = 0, tDr = 0, tCr = 0, tClose = 0;
    let dOpenNet = 0, dDr = 0, dCr = 0, dCloseNet = 0;
    for (const t of tallyRows) {
        tOpen += t.open;
        tDr += t.debit;
        tCr += t.credit;
        tClose += t.close;
        const key = norm(t.name);
        used.add(key);
        const db = byName.get(key);
        const openNet = (db?.openCr || 0) - (db?.openDr || 0);
        const closeNet = openNet + (db?.credit || 0) - (db?.debit || 0);
        // Tally export stores unsigned opening/closing. Infer side from equation.
        // Credit-nature: close = open + credit - debit (both unsigned credit)
        // Debit-nature: close = open + debit - credit
        const asCreditClose = (db ? closeNet : 0);
        const asDebitClose = db ? -closeNet : 0;
        const dbOpenAbs = db ? Math.abs((db.openDr || 0) - (db.openCr || 0)) : 0;
        const dbCloseAbs = db ? Math.abs(closeNet) : 0;
        const openOk = dbOpenAbs === t.open;
        const drOk = (db?.debit || 0) === t.debit;
        const crOk = (db?.credit || 0) === t.credit;
        const closeOk = dbCloseAbs === t.close;
        if (!db) missingInDb.push({ name: t.name, open: money(t.open), debit: money(t.debit), credit: money(t.credit), close: money(t.close) });
        else if (!openOk || !drOk || !crOk || !closeOk) {
            mismatches.push({
                name: t.name,
                tally: { open: money(t.open), debit: money(t.debit), credit: money(t.credit), close: money(t.close) },
                db: {
                    openDr: money(db.openDr),
                    openCr: money(db.openCr),
                    debit: money(db.debit),
                    credit: money(db.credit),
                    closeNet: money(closeNet),
                    closeAbs: money(dbCloseAbs)
                },
                diff: {
                    open: money(dbOpenAbs - t.open),
                    debit: money((db.debit || 0) - t.debit),
                    credit: money((db.credit || 0) - t.credit),
                    close: money(dbCloseAbs - t.close)
                }
            });
        }
    }
    for (const [key, db] of byName) {
        if (used.has(key)) continue;
        const closeNet = (db.openCr - db.openDr) + db.credit - db.debit;
        if (db.openDr || db.openCr || db.debit || db.credit) {
            extraInDb.push({
                name: db.name,
                openDr: money(db.openDr),
                openCr: money(db.openCr),
                debit: money(db.debit),
                credit: money(db.credit),
                closeNet: money(closeNet)
            });
        }
    }
    for (const db of byName.values()) {
        dOpenNet += db.openCr - db.openDr;
        dDr += db.debit;
        dCr += db.credit;
        dCloseNet += (db.openCr - db.openDr) + db.credit - db.debit;
    }

    const out = {
        tallyCount: tallyRows.length,
        dbCount: byName.size,
        matchCount: tallyRows.length - mismatches.length - missingInDb.length,
        mismatchCount: mismatches.length,
        missingInDb: missingInDb.length,
        extraInDb: extraInDb.length,
        totals: {
            tally: { openColSum: money(tOpen), debit: money(tDr), credit: money(tCr), closeColSum: money(tClose) },
            db: { netOpenCr: money(dOpenNet), debit: money(dDr), credit: money(dCr), netCloseCr: money(dCloseNet) },
            pdfGrand: { open: 332630278.48, debit: 5486019254.2, credit: 5434226296.34, close: 280837320.62 }
        },
        mismatches: mismatches.slice(0, 40),
        missingSample: missingInDb.slice(0, 20),
        extraSample: extraInDb.slice(0, 20)
    };
    fs.writeFileSync(".tmp-screditors-compare.json", JSON.stringify({ ...out, mismatches, missingInDb, extraInDb }, null, 2));
    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
