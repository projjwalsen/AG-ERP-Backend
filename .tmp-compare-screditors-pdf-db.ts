import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOT = "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb";
const PDF = { openDr: 75445285.04, openCr: 408075563.52, closeDr: 111541986.01, closeCr: 392379306.63 };
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) =>
    String(v ?? "")
        .normalize("NFKD")
        .replace(/\s*-\s*sundry\s+(?:debtor|creditor)s?\s*$/i, "")
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase();

(async () => {
    const extract = JSON.parse(fs.readFileSync(".tmp-screditors-pdf-extract.json", "utf8"));
    const pdfOpen = new Map<string, { name: string; dr: number; cr: number }>();
    const pdfMove = new Map<string, { name: string; dr: number; cr: number }>();
    for (const r of extract.openings) {
        const key = norm(r.agency);
        const row = pdfOpen.get(key) || { name: r.agency, dr: 0, cr: 0 };
        if (r.side === "DEBIT") row.dr += cents(r.amount);
        else row.cr += cents(r.amount);
        pdfOpen.set(key, row);
    }
    for (const r of extract.vouchers) {
        const key = norm(r.agency);
        const row = pdfMove.get(key) || { name: r.agency, dr: 0, cr: 0 };
        if (r.side === "DEBIT") row.dr += cents(r.amount);
        else row.cr += cents(r.amount);
        pdfMove.set(key, row);
    }

    const groups = await prisma.ledgerGroup.findMany();
    const ids = new Set([ROOT]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
            ids.add(g.id); changed = true;
        }
    }
    const ledgers = await prisma.ledger.findMany({
        where: { branchId: BRANCH_ID, groupId: { in: [...ids] } },
        select: {
            id: true, name: true, nature: true, category: true,
            openingBalance: true, openingDebit: true, openingCredit: true, currentBalance: true
        }
    });
    const entries: any[] = [];
    for (let i = 0; i < ledgers.length; i += 200) {
        entries.push(...await prisma.ledgerEntry.findMany({
            where: { ledgerId: { in: ledgers.slice(i, i + 200).map(l => l.id) } },
            include: { voucher: { select: { voucherType: true } } }
        }));
    }
    const db = new Map<string, {
        name: string; ids: string[];
        openDr: number; openCr: number; moveDr: number; moveCr: number;
        fieldOpenDr: number; fieldOpenCr: number; fieldOpenBal: number; current: number;
    }>();
    for (const l of ledgers) {
        const key = norm(l.name);
        const row = db.get(key) || {
            name: l.name, ids: [], openDr: 0, openCr: 0, moveDr: 0, moveCr: 0,
            fieldOpenDr: 0, fieldOpenCr: 0, fieldOpenBal: 0, current: 0
        };
        row.ids.push(l.id);
        row.fieldOpenDr += cents(l.openingDebit);
        row.fieldOpenCr += cents(l.openingCredit);
        row.fieldOpenBal += cents(l.openingBalance);
        row.current += cents(l.currentBalance);
        db.set(key, row);
    }
    const ledgerName = new Map(ledgers.map(l => [l.id, l.name]));
    for (const e of entries) {
        const key = norm(ledgerName.get(e.ledgerId) || "");
        const row = db.get(key);
        if (!row) continue;
        const amount = cents(e.amount);
        if (e.voucher.voucherType === "OPENING_BALANCE") {
            if (e.entryType === "DEBIT") row.openDr += amount;
            else row.openCr += amount;
        } else if (e.entryType === "DEBIT") row.moveDr += amount;
        else row.moveCr += amount;
    }

    const mismatches: any[] = [];
    const keys = new Set([...pdfOpen.keys(), ...pdfMove.keys(), ...db.keys()]);
    let dbOpenDr = 0, dbOpenCr = 0, dbMoveDr = 0, dbMoveCr = 0, dbCloseDr = 0, dbCloseCr = 0;
    let fieldOpenDr = 0, fieldOpenCr = 0, fieldOpenBal = 0, currentSum = 0;
    let calcCloseDr = 0, calcCloseCr = 0;
    for (const key of keys) {
        const pOpen = pdfOpen.get(key) || { name: key, dr: 0, cr: 0 };
        const pMove = pdfMove.get(key) || { name: pOpen.name, dr: 0, cr: 0 };
        const d = db.get(key);
        const pClose = (pOpen.dr - pOpen.cr) + pMove.dr - pMove.cr;
        const dClose = d ? (d.openDr - d.openCr) + d.moveDr - d.moveCr : 0;
        if (d) {
            dbOpenDr += d.openDr; dbOpenCr += d.openCr;
            dbMoveDr += d.moveDr; dbMoveCr += d.moveCr;
            if (dClose > 0) dbCloseDr += dClose; else dbCloseCr += -dClose;
            fieldOpenDr += d.fieldOpenDr; fieldOpenCr += d.fieldOpenCr;
            fieldOpenBal += d.fieldOpenBal; currentSum += d.current;
            // calculateLedgerBalance: opening fields + ALL entries including opening vouchers
            const fieldOpen = d.fieldOpenDr || d.fieldOpenCr
                ? d.fieldOpenDr - d.fieldOpenCr
                : 0;
            const allDr = d.openDr + d.moveDr;
            const allCr = d.openCr + d.moveCr;
            const calc = fieldOpen + allDr - allCr;
            if (calc > 0) calcCloseDr += calc; else calcCloseCr += -calc;
        }
        if (!d && (pOpen.dr || pOpen.cr || pMove.dr || pMove.cr)) {
            mismatches.push({ kind: "missingInDb", name: pOpen.name || pMove.name, pOpen, pMove, pClose: money(pClose) });
            continue;
        }
        if (d && (d.openDr !== pOpen.dr || d.openCr !== pOpen.cr || d.moveDr !== pMove.dr || d.moveCr !== pMove.cr)) {
            mismatches.push({
                kind: "mismatch",
                name: d.name,
                pdf: { openDr: money(pOpen.dr), openCr: money(pOpen.cr), moveDr: money(pMove.dr), moveCr: money(pMove.cr), close: money(pClose) },
                db: { openDr: money(d.openDr), openCr: money(d.openCr), moveDr: money(d.moveDr), moveCr: money(d.moveCr), close: money(dClose), fieldOpenDr: money(d.fieldOpenDr), fieldOpenCr: money(d.fieldOpenCr), fieldOpenBal: money(d.fieldOpenBal) }
            });
        }
    }
    const extraDb = [...db.entries()]
        .filter(([k, d]) => !pdfOpen.has(k) && !pdfMove.has(k) && (d.openDr || d.openCr || d.moveDr || d.moveCr))
        .map(([k, d]) => ({
            name: d.name,
            openDr: money(d.openDr), openCr: money(d.openCr),
            moveDr: money(d.moveDr), moveCr: money(d.moveCr),
            close: money((d.openDr - d.openCr) + d.moveDr - d.moveCr)
        }));

    const out = {
        pdfGrand: PDF,
        dbEntries: {
            openingDebit: money(dbOpenDr), openingCredit: money(dbOpenCr),
            periodDebit: money(dbMoveDr), periodCredit: money(dbMoveCr),
            closingDebit: money(dbCloseDr), closingCredit: money(dbCloseCr),
            netClosingCredit: money(dbCloseCr - dbCloseDr)
        },
        dbFields: {
            openingDebit: money(fieldOpenDr), openingCredit: money(fieldOpenCr),
            openingBalance: money(fieldOpenBal), currentBalanceSum: money(currentSum)
        },
        uiCalculateLedgerBalanceWouldShow: {
            closingDebit: money(calcCloseDr),
            closingCredit: money(calcCloseCr),
            netClosingCredit: money(calcCloseCr - calcCloseDr)
        },
        matchEntriesToPdf: {
            openingDebit: money(dbOpenDr) === PDF.openDr,
            openingCredit: money(dbOpenCr) === PDF.openCr,
            periodDebit: money(dbMoveDr) === 5486019254.2,
            periodCredit: money(dbMoveCr) === 5434226296.34,
            closingDebit: money(dbCloseDr) === PDF.closeDr,
            closingCredit: money(dbCloseCr) === PDF.closeCr
        },
        mismatchCount: mismatches.length,
        extraDbCount: extraDb.length,
        mismatches: mismatches.slice(0, 40),
        extraDb: extraDb.slice(0, 40)
    };
    fs.writeFileSync(".tmp-screditors-pdf-db-compare.json", JSON.stringify({ ...out, mismatches, extraDb }, null, 2));
    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
