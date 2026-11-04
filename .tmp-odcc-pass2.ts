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
const BANK_ACCOUNTS_ID = "7cf41220-8e89-4cd1-b6ce-e7bac996abd6";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const PARKS = JSON.parse(fs.readFileSync(".tmp-odcc-apply-backup.json", "utf8")).parkSample as any[];
const miss2 = JSON.parse(fs.readFileSync(".tmp-odcc-still-after.json", "utf8")).miss2 as any[];

function stealable(e: any) {
    const name = norm(e.ledger.name);
    const group = norm(e.ledger.group?.name);
    if (BOM_IDS.includes(e.ledgerId) || BOB_IDS.includes(e.ledgerId)) return false;
    if (e.ledger.category === "CUSTOMER" || e.ledger.category === "VENDOR") return false;
    if (/SUNDRY CREDITOR|SUNDRY DEBTOR|DUTIES & TAX|TDS ON |TCS ON |INPUT CGST|INPUT SGST|INPUT IGST|OUTPUT /.test(name + " " + group) && name !== "BANK ACCOUNTS") return false;
    if (name === "BANK ACCOUNTS") return true;
    if (e.ledger.category === "BANK") return true;
    if (group === "BANK ACCOUNTS") return true;
    if (e.ledgerId === BANK_ACCOUNTS_ID) return true;
    return false;
}

(async () => {
    // 1. Unpark all 10 back to BOM
    if (PARKS.length) {
        const values = PARKS.map((r: any) => `('${r.entryId}','${CANON_BOM}')`).join(",");
        await prisma.$executeRawUnsafe(
            `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
        );
    }

    const relink: any[] = [];
    const adds: any[] = [];
    const used = new Set<string>(PARKS.map(p => p.entryId));

    const nos = [...new Set(miss2.map(r => String(r.no)))];
    const altNos = [...nos, "21.9", "11556-TDS-MAR25", "CB-CONTRA-20260307", "KFD401-CONTRA-20251114", "11556"];
    const vouchers = await prisma.voucher.findMany({
        where: { branchId: BRANCH_ID, voucherNo: { in: altNos } },
        select: {
            id: true, voucherNo: true, voucherType: true, voucherDate: true, narration: true,
            totalDebit: true, totalCredit: true,
            entries: {
                select: {
                    id: true, ledgerId: true, entryType: true, amount: true,
                    ledger: { select: { name: true, category: true, group: { select: { name: true } } } }
                }
            }
        }
    });

    const byNo = new Map<string, typeof vouchers>();
    for (const v of vouchers) {
        const k = String(v.voucherNo);
        byNo.set(k, [...(byNo.get(k) || []), v]);
    }

    const remaining = [...miss2];
    const resolved: any[] = [];

    const considerNos = (row: any) => {
        const n = String(row.no);
        const alts = [n];
        if (n === "21") alts.push("21.9");
        if (n === "11556") alts.push("11556-TDS-MAR25");
        if (n === "8908") alts.push("CB-CONTRA-20260307");
        if (n === "14080") alts.push("KFD401-CONTRA-20251114");
        return alts;
    };

    for (const row of remaining) {
        const amt = cents(row.amount);
        const vs = considerNos(row).flatMap(n => byNo.get(n) || []);
        const bankLines = vs.flatMap(v => v.entries.filter(e =>
            e.entryType === row.side &&
            (stealable(e) || BOM_IDS.includes(e.ledgerId)) &&
            !used.has(e.id)
        ));
        const alreadyBom = bankLines.filter(e => BOM_IDS.includes(e.ledgerId));
        const steal = bankLines.filter(e => !BOM_IDS.includes(e.ledgerId));

        // Exact amount steal
        const exact = steal.find(e => cents(e.amount) === amt);
        if (exact) {
            used.add(exact.id);
            relink.push({ entryId: exact.id, from: exact.ledgerId, to: CANON_BOM, no: row.no, amount: row.amount, how: "exact" });
            resolved.push({ no: row.no, how: "exact-steal", amount: row.amount });
            continue;
        }
        const exactBom = alreadyBom.find(e => cents(e.amount) === amt);
        if (exactBom) {
            used.add(exactBom.id);
            resolved.push({ no: row.no, how: "already-unparked", amount: row.amount });
            continue;
        }

        // Sum of stealable (+ already BOM not used by other rows) on these vouchers
        const pool = [...steal, ...alreadyBom];
        const sum = pool.reduce((s, e) => s + cents(e.amount), 0);
        if (sum === amt && pool.length) {
            for (const e of steal) {
                used.add(e.id);
                relink.push({ entryId: e.id, from: e.ledgerId, to: CANON_BOM, no: row.no, amount: Number(e.amount), how: "sum" });
            }
            for (const e of alreadyBom) used.add(e.id);
            resolved.push({ no: row.no, how: "sum", sum: money(sum), amount: row.amount, n: pool.length });
            continue;
        }

        // Relink stealable parts. Only add a remainder line if the host voucher
        // is already unbalanced by exactly that remainder (missing bank side).
        if (pool.length && sum < amt) {
            for (const e of steal) {
                used.add(e.id);
                relink.push({ entryId: e.id, from: e.ledgerId, to: CANON_BOM, no: row.no, amount: Number(e.amount), how: "partial" });
            }
            for (const e of alreadyBom) used.add(e.id);
            const rest = amt - sum;
            const host = vs.find(v => {
                const dr = v.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
                const cr = v.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
                const gap = dr - cr;
                return (row.side === "CREDIT" && gap === rest) || (row.side === "DEBIT" && gap === -rest);
            }) || vs.find(v => {
                const dr = v.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
                const cr = v.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
                return (row.side === "CREDIT" && cr === 0 && dr === rest) || (row.side === "DEBIT" && dr === 0 && cr === rest);
            });
            if (host) {
                const dr = host.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
                const cr = host.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
                adds.push({
                    id: randomUUID(),
                    voucherId: host.id,
                    ledgerId: CANON_BOM,
                    entryType: row.side,
                    amount: money(rest),
                    narration: `OD/CC split remainder ${row.no} ${row.particular || ""}`.slice(0, 200),
                    no: row.no,
                    rest: money(rest),
                    hostNo: host.voucherNo,
                    newTotalDebit: money(dr + (row.side === "DEBIT" ? rest : 0)),
                    newTotalCredit: money(cr + (row.side === "CREDIT" ? rest : 0))
                });
                resolved.push({ no: row.no, how: "partial+add", have: money(sum), add: money(rest), amount: row.amount });
                continue;
            }
            resolved.push({ no: row.no, how: "partial-only", have: money(sum), need: money(rest), amount: row.amount });
            continue;
        }

        resolved.push({
            no: row.no, how: "unresolved", amount: row.amount, sum: money(sum),
            vs: vs.map(v => ({
                no: v.voucherNo, type: v.voucherType, date: localDate(v.voucherDate),
                totDr: Number(v.totalDebit), totCr: Number(v.totalCredit),
                entries: v.entries.map(e => ({ side: e.entryType, amount: Number(e.amount), name: e.ledger.name, id: e.id, steal: stealable(e) || BOM_IDS.includes(e.ledgerId) }))
            }))
        });
    }

    // Also search amount+date on Bank Accounts for unresolved
    const unresolved = resolved.filter(r => r.how === "unresolved");
    for (const u of unresolved) {
        const row = miss2.find(r => String(r.no) === String(u.no) && cents(r.amount) === cents(u.amount));
        if (!row) continue;
        const hits = await prisma.ledgerEntry.findMany({
            where: {
                entryType: row.side,
                amount: row.amount,
                voucher: { branchId: BRANCH_ID, voucherDate: { gte: START, lte: END } },
                ledger: { OR: [{ id: BANK_ACCOUNTS_ID }, { name: { equals: "Bank Accounts", mode: "insensitive" } }, { category: "BANK" }] }
            },
            select: {
                id: true, ledgerId: true, amount: true,
                ledger: { select: { name: true } },
                voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } }
            },
            take: 5
        });
        const free = hits.find(h => !used.has(h.id) && !BOM_IDS.includes(h.ledgerId));
        if (free) {
            used.add(free.id);
            relink.push({ entryId: free.id, from: free.ledgerId, to: CANON_BOM, no: row.no, amount: row.amount, how: "amt-date" });
            u.how = "amt-date";
            u.foundNo = free.voucher.voucherNo;
        } else {
            u.amtHits = hits.map(h => ({ id: h.id, no: h.voucher.voucherNo, type: h.voucher.voucherType, date: localDate(h.voucher.voucherDate), name: h.ledger.name }));
        }
    }

    console.log(JSON.stringify({
        unparked: PARKS.length,
        relink: relink.length,
        adds: adds.length,
        byHow: resolved.reduce((a: any, r: any) => { a[r.how] = (a[r.how] || 0) + 1; return a; }, {}),
        resolved,
        relinkSample: relink.slice(0, 8),
        adds
    }, null, 2));

    for (let i = 0; i < relink.length; i += 200) {
        const chunk = relink.slice(i, i + 200);
        const values = chunk.map((r: any) => `('${r.entryId}','${r.to}')`).join(",");
        if (!values) continue;
        await prisma.$executeRawUnsafe(
            `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
        );
    }
    if (adds.length) {
        await prisma.ledgerEntry.createMany({
            data: adds.map(a => ({
                id: a.id,
                voucherId: a.voucherId,
                ledgerId: a.ledgerId,
                branchId: BRANCH_ID,
                entryType: a.entryType,
                amount: a.amount,
                narration: a.narration
            }))
        });
        for (const a of adds) {
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
        select: { id: true, entryType: true, amount: true, voucher: { select: { voucherNo: true, voucherType: true } } }
    });
    const used2 = new Set<string>();
    const by2 = new Map<string, string[]>();
    const byAmt = new Map<string, string[]>();
    for (const e of after) {
        const k = `${norm(e.voucher.voucherNo)}|${e.entryType}|${cents(e.amount)}`;
        by2.set(k, [...(by2.get(k) || []), e.id]);
        const k2 = `${e.entryType}|${cents(e.amount)}`;
        byAmt.set(k2, [...(byAmt.get(k2) || []), e.id]);
    }
    const bomXl = JSON.parse(fs.readFileSync(".tmp-odcc-bom.json", "utf8"));
    let matched = 0;
    const miss: any[] = [];
    for (const row of bomXl.vouchers) {
        const alts = [norm(row.no)];
        if (String(row.no) === "21") alts.push("21.9");
        if (String(row.no) === "11556") alts.push("11556-TDS-MAR25");
        if (String(row.no) === "8908") alts.push("CB-CONTRA-20260307");
        if (String(row.no) === "14080") alts.push("KFD401-CONTRA-20251114");
        let hit: string | undefined;
        for (const no of alts) {
            const ids = (by2.get(`${no}|${row.side}|${cents(row.amount)}`) || []).filter(id => !used2.has(id));
            if (ids[0]) { hit = ids[0]; break; }
        }
        if (hit) { used2.add(hit); matched += 1; }
        else miss.push(row);
    }
    let dr = 0, cr = 0;
    for (const e of after) {
        if (e.entryType === "DEBIT") dr += cents(e.amount); else cr += cents(e.amount);
    }
    const extra = after.filter(e => !used2.has(e.id));
    const openings = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: [...BOM_IDS, ...BOB_IDS] }, voucher: { voucherType: "OPENING_BALANCE" } },
        select: { ledger: { select: { name: true } }, entryType: true, amount: true }
    });
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
    const tb = walk(report.tree || []).filter(x =>
        /bank od|60434886441|13780500000078/i.test(x.path)
    ).map(x => ({
        path: x.path,
        od: x.node.openingDebit, oc: x.node.openingCredit,
        pd: x.node.periodDebit, pc: x.node.periodCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));

    console.log("AFTER", JSON.stringify({
        matched, missing: miss.length, extra: extra.length,
        dr: money(dr), cr: money(cr),
        excelDr: bomXl.perDr, excelCr: bomXl.perCr,
        dDr: money(dr - cents(bomXl.perDr)), dCr: money(cr - cents(bomXl.perCr)),
        miss,
        extraSample: extra.slice(0, 8).map(e => ({ no: e.voucher.voucherNo, type: e.voucher.voucherType, side: e.entryType, amount: Number(e.amount) })),
        openings, bob: { dr: money(bobDr), cr: money(bobCr) },
        tb
    }, null, 2));

    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
