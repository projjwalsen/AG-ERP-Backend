import "dotenv/config";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const BOM_IDS = ["c1f62a06-f402-4b4c-a2b3-1dc3cb31c0b5", "8faa06f2-6b04-404e-8729-1cc3dd5d073b"];
const BOB_IDS = ["dc58112c-b8ea-4845-a598-c1cdffc44d6b", "9b5650be-5530-4401-8515-933dda455174"];
const CANON_BOM = "8faa06f2-6b04-404e-8729-1cc3dd5d073b";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const DEBIT_GAPS = [
    { no: "13947", amount: 1954726 },
    { no: "13972", amount: 406065 },
    { no: "15557", amount: 935082 },
    { no: "15612", amount: 19879078 },
    { no: "15720", amount: 14977112.75 },
    { no: "16645", amount: 14146914 },
    { no: "16708", amount: 6316042 },
    { no: "17232", amount: 7005377 },
    { no: "17242", amount: 4030 },
    { no: "17243", amount: 6331 },
    { no: "17864", amount: 433823 }
];
const EMI = [
    { no: "10672", principal: 124981, date: "2025-04-03" },
    { no: "10725", principal: 148953, date: "2025-04-04" },
    { no: "10726", principal: 150939, date: "2025-05-04" },
    { no: "10694", principal: 169084, date: "2025-05-05" },
    { no: "11308", principal: 2884, date: "2025-05-07" },
    { no: "10695", principal: 170006, date: "2025-06-05" },
    { no: "10729", principal: 157057, date: "2025-08-04" },
    { no: "10698", principal: 177263, date: "2025-09-05" }
];

(async () => {
    const relink: any[] = [];
    const adds: any[] = [];
    const notes: any[] = [];

    for (const g of DEBIT_GAPS) {
        const entries = await prisma.ledgerEntry.findMany({
            where: {
                amount: g.amount,
                entryType: "DEBIT",
                voucher: { branchId: BRANCH_ID, voucherNo: String(g.no) }
            },
            select: {
                id: true, ledgerId: true, amount: true,
                ledger: { select: { name: true, category: true, group: { select: { name: true } } } },
                voucher: { select: { id: true, voucherType: true, narration: true, voucherDate: true } }
            }
        });
        const pick = entries.find(e =>
            !BOM_IDS.includes(e.ledgerId) &&
            (e.ledger.category === "CUSTOMER" ||
                /SUNDRY DEBTOR|ADVANCE FROM/i.test(e.ledger.name + " " + (e.ledger.group?.name || "")) ||
                /Advance From S\. Debtors|Reconciled from Advance/i.test(e.voucher.narration || ""))
        ) || entries.find(e => !BOM_IDS.includes(e.ledgerId) && e.ledger.category !== "VENDOR");
        notes.push({
            no: g.no, amount: g.amount,
            found: entries.map(e => ({ id: e.id, name: e.ledger.name, cat: e.ledger.category, group: e.ledger.group?.name, narr: (e.voucher.narration || "").slice(0, 80) })),
            pick: pick ? { id: pick.id, name: pick.ledger.name } : null
        });
        if (pick) relink.push({ entryId: pick.id, from: pick.ledgerId, fromName: pick.ledger.name, to: CANON_BOM, no: g.no, amount: g.amount });
    }

    // EMI principals: look up existing loan-ledger debits of that amount, else add to the interest voucher
    let loanLedger = await prisma.ledger.findFirst({
        where: {
            OR: [
                { name: { contains: "Unsecured Loan", mode: "insensitive" } },
                { name: { contains: "Loan From Director", mode: "insensitive" } }
            ],
            group: { name: { contains: "Unsecured", mode: "insensitive" } }
        },
        select: { id: true, name: true, group: { select: { name: true } } }
    });
    const loanHits = await prisma.ledger.findMany({
        where: { name: { contains: "Unsecured", mode: "insensitive" } },
        select: { id: true, name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } },
        take: 20
    });
    notes.push({ loanLedger, loanHits: loanHits.slice(0, 12) });

    for (const e of EMI) {
        const existing = await prisma.ledgerEntry.findMany({
            where: {
                amount: e.principal,
                voucher: { branchId: BRANCH_ID, voucherDate: { gte: START, lte: END } }
            },
            select: {
                id: true, ledgerId: true, entryType: true,
                ledger: { select: { name: true, category: true, group: { select: { name: true } } } },
                voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true, narration: true } }
            },
            take: 8
        });
        const onBom = existing.find(x => BOM_IDS.includes(x.ledgerId) && x.entryType === "CREDIT");
        if (onBom) {
            notes.push({ emi: e.no, how: "already-on-bom", existing: existing.map(x => ({ no: x.voucher.voucherNo, name: x.ledger.name, side: x.entryType })) });
            continue;
        }
        const host = await prisma.voucher.findFirst({
            where: { branchId: BRANCH_ID, voucherNo: e.no, voucherType: "JOURNAL" },
            select: {
                id: true, voucherNo: true,
                entries: { select: { id: true, entryType: true, amount: true, ledgerId: true, ledger: { select: { name: true } } } }
            }
        });
        notes.push({
            emi: e.no, principal: e.principal, host: host?.id,
            existing: existing.map(x => ({ no: x.voucher.voucherNo, type: x.voucher.voucherType, date: localDate(x.voucher.voucherDate), name: x.ledger.name, side: x.entryType, narr: (x.voucher.narration || "").slice(0, 70) }))
        });
        if (!host) continue;
        // Prefer debiting the same unsecured-loan family as the interest line if a loan ledger exists on host
        const interest = host.entries.find(x => /INTEREST ON UNSECURED LOAN/i.test(x.ledger.name));
        let principalLedgerId = loanLedger?.id;
        if (!principalLedgerId) {
            const named = loanHits.find(l => /POONAWALA|CLIX|DIRECTOR|UNSECURED LOAN/i.test(l.name) && !/INTEREST/i.test(l.name));
            principalLedgerId = named?.id;
        }
        // If principal amount already exists as a debit somewhere on a loan ledger, relink its missing credit... 
        const loanDebit = existing.find(x =>
            x.entryType === "DEBIT" &&
            /LOAN|UNSECURED/i.test(x.ledger.name + " " + (x.ledger.group?.name || "")) &&
            !/INTEREST/i.test(x.ledger.name)
        );
        if (loanDebit) {
            // Check if that voucher is missing BOM credit
            const v = await prisma.voucher.findFirst({
                where: { voucherNo: loanDebit.voucher.voucherNo, branchId: BRANCH_ID },
                select: { id: true, entries: { select: { ledgerId: true, entryType: true, amount: true } } }
            });
            const hasBomCr = v?.entries.some(en => BOM_IDS.includes(en.ledgerId) && en.entryType === "CREDIT" && cents(en.amount) === cents(e.principal));
            if (v && !hasBomCr) {
                const dr = v.entries.filter(en => en.entryType === "DEBIT").reduce((s, en) => s + cents(en.amount), 0);
                const cr = v.entries.filter(en => en.entryType === "CREDIT").reduce((s, en) => s + cents(en.amount), 0);
                adds.push({
                    id: randomUUID(), voucherId: v.id, ledgerId: CANON_BOM, branchId: BRANCH_ID,
                    entryType: "CREDIT", amount: e.principal, narration: `OD/CC EMI principal ${e.no}`,
                    newTotalDebit: money(dr), newTotalCredit: money(cr + cents(e.principal))
                });
                continue;
            }
        }
        if (!principalLedgerId) {
            // Last resort: add only the BOM credit on the interest voucher (unbalances unless we also debit interest - don't)
            // Add both Dr principal (use interest ledger's sibling if needed) and Cr BOM
            const fallback = await prisma.ledger.findFirst({
                where: { name: { equals: "Unsecured Loans", mode: "insensitive" } },
                select: { id: true, name: true }
            });
            principalLedgerId = fallback?.id;
            notes.push({ emi: e.no, fallback, principalLedgerId });
        }
        if (principalLedgerId && host) {
            const dr = host.entries.filter(x => x.entryType === "DEBIT").reduce((s, x) => s + cents(x.amount), 0);
            const cr = host.entries.filter(x => x.entryType === "CREDIT").reduce((s, x) => s + cents(x.amount), 0);
            adds.push({
                id: randomUUID(), voucherId: host.id, ledgerId: principalLedgerId, branchId: BRANCH_ID,
                entryType: "DEBIT", amount: e.principal, narration: `OD/CC EMI principal ${e.no}`,
            });
            adds.push({
                id: randomUUID(), voucherId: host.id, ledgerId: CANON_BOM, branchId: BRANCH_ID,
                entryType: "CREDIT", amount: e.principal, narration: `OD/CC EMI principal bank ${e.no}`,
                newTotalDebit: money(dr + cents(e.principal)),
                newTotalCredit: money(cr + cents(e.principal)),
                hostId: host.id
            });
        }
        void interest;
    }

    console.log(JSON.stringify({ relink: relink.length, adds: adds.length, notes }, null, 2));

    if (relink.length) {
        const values = relink.map(r => `('${r.entryId}','${r.to}')`).join(",");
        await prisma.$executeRawUnsafe(
            `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
        );
    }
    if (adds.length) {
        await prisma.ledgerEntry.createMany({
            data: adds.map(a => ({
                id: a.id, voucherId: a.voucherId, ledgerId: a.ledgerId, branchId: a.branchId,
                entryType: a.entryType, amount: a.amount, narration: a.narration
            }))
        });
        const hosts = new Map<string, any>();
        for (const a of adds) {
            if (a.newTotalDebit != null) hosts.set(a.voucherId, a);
        }
        for (const a of hosts.values()) {
            await prisma.voucher.update({
                where: { id: a.voucherId },
                data: { totalDebit: a.newTotalDebit, totalCredit: a.newTotalCredit }
            });
        }
    }

    const after = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: BOM_IDS },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: { entryType: true, amount: true }
    });
    let dr = 0, cr = 0;
    for (const e of after) {
        if (e.entryType === "DEBIT") dr += cents(e.amount); else cr += cents(e.amount);
    }
    const bomXl = JSON.parse(fs.readFileSync(".tmp-odcc-bom.json", "utf8"));
    const bob = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: BOB_IDS }, voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } } },
        select: { entryType: true, amount: true }
    });
    let bobDr = 0, bobCr = 0;
    for (const e of bob) {
        if (e.entryType === "DEBIT") bobDr += cents(e.amount); else bobCr += cents(e.amount);
    }
    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH_ID, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const tb = walk(report.tree || []).filter(x => /Bank OD A\/c|60434886441|13780500000078/.test(x.path)).map(x => ({
        path: x.path,
        od: x.node.openingDebit, oc: x.node.openingCredit,
        pd: x.node.periodDebit, pc: x.node.periodCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));
    console.log("AFTER", JSON.stringify({
        relinkFrom: relink.map(r => ({ no: r.no, from: r.fromName, amount: r.amount })),
        bom: { dr: money(dr), cr: money(cr), excelDr: bomXl.perDr, excelCr: bomXl.perCr, dDr: money(dr - cents(bomXl.perDr)), dCr: money(cr - cents(bomXl.perCr)) },
        bob: { dr: money(bobDr), cr: money(bobCr) },
        opening: 302852776.8,
        excelClose: 316017958.99,
        tb
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
