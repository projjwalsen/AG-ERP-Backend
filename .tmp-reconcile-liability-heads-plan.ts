import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ROOTS: Record<string, string> = {
    "Sundry Creditors": "5a4f4bea-25a5-4716-ab8f-c4e38b4eafcb",
    "Advance From S. Debtors": "6cfbfae5-9fb5-486b-a317-33d4ab097601"
};
const TYPE_MAP: Record<string, string> = {
    Payment: "PAYMENT",
    Receipt: "RECEIPT",
    Purchase: "PURCHASE",
    "RCM Purchase": "RCM_PURCHASE",
    Journal: "JOURNAL",
    "Journal Expenses": "JOURNAL",
    "Inward Debit Note": "DEBIT_NOTE",
    "Inward Credit Note": "CREDIT_NOTE",
    "RCM Debit Note": "DEBIT_NOTE",
    "CASH PAYMENT": "CASH_PAYMENT",
    "Salary Payment": "PAYMENT",
    "Tax Invoice": "SALE"
};
const norm = (value: unknown) =>
    String(value ?? "")
        .normalize("NFKD")
        .replace(/\s*-\s*sundry\s+(?:debtor|creditor)s?\s*$/i, "")
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase();
const cents = (value: unknown) => Math.round(Number(value || 0) * 100) || 0;
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

(async () => {
    const audit = JSON.parse(fs.readFileSync(".tmp-reconcile-liability-heads-audit.json", "utf8"));
    const groups = await prisma.ledgerGroup.findMany();
    const descendants = (root: string) => {
        const ids = new Set([root]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const g of groups) {
                if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
                    ids.add(g.id);
                    changed = true;
                }
            }
        }
        return ids;
    };
    const scopes = new Map(Object.entries(ROOTS).map(([head, id]) => [head, descendants(id)]));
    const allLedgers = await prisma.ledger.findMany({
        where: { OR: [{ branchId: BRANCH_ID }, { branchId: null }] },
        select: { id: true, name: true, groupId: true, category: true, nature: true, branchId: true, isActive: true }
    });
    const counts = await prisma.ledgerEntry.groupBy({
        by: ["ledgerId"],
        where: { ledgerId: { in: allLedgers.map(l => l.id) } },
        _count: { id: true }
    });
    const countMap = new Map(counts.map(c => [c.ledgerId, c._count.id]));
    const pick = (name: string, head?: string) => {
        const wanted = allLedgers
            .filter(l => l.branchId === BRANCH_ID && norm(l.name) === norm(name))
            .filter(l => !head || scopes.get(head)?.has(l.groupId))
            .sort((a, b) => Number(countMap.get(b.id) || 0) - Number(countMap.get(a.id) || 0));
        return wanted[0] || null;
    };

    const relink: any[] = [];
    const skipRelink: any[] = [];
    const usedEntries = new Set<string>();
    for (const item of audit.classified.exactElsewhere) {
        const row = item.row;
        const target = pick(row.agency, row.head);
        const hit = item.hits.find((h: any) => norm(h.ledger) === row.agencyNorm && !usedEntries.has(h.entryId));
        if (!target) {
            skipRelink.push({ reason: "no-target-ledger", row, hits: item.hits });
            continue;
        }
        if (!hit) {
            skipRelink.push({ reason: "no-agency-named-hit", row, hits: item.hits });
            continue;
        }
        if (hit.ledgerId === target.id) {
            skipRelink.push({ reason: "already-on-target", row, hit });
            continue;
        }
        usedEntries.add(hit.entryId);
        relink.push({
            head: row.head,
            row: row.row,
            agency: row.agency,
            no: row.no,
            type: row.type,
            date: row.date,
            side: row.side,
            cents: row.cents,
            entryId: hit.entryId,
            voucherId: hit.voucherId,
            oldLedgerId: hit.ledgerId,
            oldLedgerName: hit.ledger,
            oldGroupId: hit.groupId,
            targetLedgerId: target.id,
            targetLedgerName: target.name
        });
    }

    const create: any[] = [];
    const createProblems: any[] = [];
    const remaining = [
        ...audit.classified.sameNoTypeWrong.map((x: any) => x.row),
        ...audit.classified.noVoucher,
        ...audit.classified.blankNo
    ];
    for (const row of remaining) {
        const party = pick(row.agency, row.head);
        const contra = pick(row.particulars);
        const voucherType = TYPE_MAP[row.type];
        if (!party || !contra || !voucherType || !row.cents || (!row.no && row.type !== "Payment")) {
            createProblems.push({
                row,
                party: party?.name || null,
                contra: contra?.name || null,
                voucherType: voucherType || null
            });
            continue;
        }
        create.push({
            head: row.head,
            row: row.row,
            agency: row.agency,
            no: row.no || `RECON-${row.head.slice(0, 2).toUpperCase()}-${row.row}`,
            generatedNo: !row.no,
            type: row.type,
            voucherType,
            date: row.date,
            side: row.side,
            amount: row.cents / 100,
            particulars: row.particulars,
            partyId: party.id,
            partyName: party.name,
            contraId: contra.id,
            contraName: contra.name
        });
    }

    const extra = audit.extra;
    const extraVoucherIds = extra.map((e: any) => e.voucherId);
    const extraVouchers = extraVoucherIds.length
        ? await prisma.voucher.findMany({
            where: { id: { in: extraVoucherIds } },
            include: { entries: { include: { ledger: true } }, journals: true, transaction: true, debitCreditNotes: true }
        })
        : [];
    const extraById = new Map(extraVouchers.map(v => [v.id, v]));
    const unlink: any[] = [];
    const extraKeep: any[] = [];
    for (const e of extra) {
        const v = extraById.get(e.voucherId);
        const excelHit = (audit.unmatched as any[]).find((r: any) =>
            r.no && r.no === e.no && r.agencyNorm === norm(e.ledger) && r.side === e.side && r.cents === e.cents
        );
        if (excelHit) {
            extraKeep.push({ reason: "matches-unmatched-excel-ignoring-date-or-type", e, excelHit });
            continue;
        }
        unlink.push({
            entryId: e.entryId,
            voucherId: e.voucherId,
            ledgerId: e.ledgerId,
            ledger: e.ledger,
            no: e.no,
            type: e.type,
            date: e.date,
            side: e.side,
            cents: e.cents,
            otherEntries: (v?.entries || []).filter((x: any) => x.id !== e.entryId).map((x: any) => ({
                ledger: x.ledger.name,
                groupId: x.ledger.groupId,
                side: x.entryType,
                cents: cents(x.amount)
            })),
            hasJournal: Boolean(v?.journals?.length),
            hasTransaction: Boolean(v?.transaction?.length),
            hasNote: Boolean(v?.debitCreditNotes?.length)
        });
    }

    const blank = audit.classified.blankNo[0];
    let blankMatch: any = null;
    if (blank) {
        const near = await prisma.ledgerEntry.findMany({
            where: {
                branchId: BRANCH_ID,
                entryType: "DEBIT",
                amount: blank.cents / 100
            },
            include: { voucher: true, ledger: true }
        });
        blankMatch = near.filter(e =>
            localDate(e.voucher.voucherDate) === blank.date &&
            ["PAYMENT", "BANK_PAYMENT"].includes(e.voucher.voucherType)
        ).map(e => ({
            entryId: e.id,
            voucherId: e.voucherId,
            no: e.voucher.voucherNo,
            type: e.voucher.voucherType,
            ledger: e.ledger.name,
            groupId: e.ledger.groupId,
            date: localDate(e.voucher.voucherDate)
        }));
    }

    const stats = {
        relink: relink.length,
        relinkByHead: relink.reduce((a: any, x: any) => (a[x.head] = (a[x.head] || 0) + 1, a), {}),
        relinkCents: relink.reduce((s, x) => s + x.cents, 0) / 100,
        skipRelink: skipRelink.length,
        skipReasons: skipRelink.reduce((a: any, x: any) => (a[x.reason] = (a[x.reason] || 0) + 1, a), {}),
        create: create.length,
        createByHead: create.reduce((a: any, x: any) => (a[x.head] = (a[x.head] || 0) + 1, a), {}),
        createCents: create.reduce((s, x) => s + Math.round(x.amount * 100), 0) / 100,
        createProblems: createProblems.length,
        unlink: unlink.length,
        unlinkCents: unlink.reduce((s, x) => s + x.cents, 0) / 100,
        extraKeep: extraKeep.length,
        blankMatch
    };
    fs.writeFileSync(".tmp-reconcile-liability-heads-plan.json", JSON.stringify({
        stats, relink, skipRelink, create, createProblems, unlink, extraKeep, blankMatch
    }, null, 2));
    console.log(JSON.stringify({ stats, skipSample: skipRelink.slice(0, 8), createProblems, unlink, create }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
