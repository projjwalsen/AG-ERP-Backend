import "dotenv/config";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const WIDE_START = new Date("2025-03-30T18:30:00.000Z");
const BOM_IDS = ["c1f62a06-f402-4b4c-a2b3-1dc3cb31c0b5", "8faa06f2-6b04-404e-8729-1cc3dd5d073b"];
const BOB_IDS = ["dc58112c-b8ea-4845-a598-c1cdffc44d6b", "9b5650be-5530-4401-8515-933dda455174"];
const HEADING_UNSEC = "bd2899d0-0a09-4ca1-89fe-4d5601c9dccf";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();

const PROTECTED_NAME = /SUNDRY CREDITOR|DUTIES|TDS ON |TCS ON |INPUT CGST|INPUT SGST|INPUT IGST|OUTPUT CGST|OUTPUT SGST|OUTPUT IGST|60434886441|13780500000078/;

function stealOk(e: any) {
    if (BOM_IDS.includes(e.ledgerId) || BOB_IDS.includes(e.ledgerId)) return false;
    if (e.ledger.category === "VENDOR" || e.ledger.category === "CUSTOMER") return false;
    const blob = `${e.ledger.name} ${e.ledger.group?.name || ""} ${e.ledger.group?.parent?.name || ""}`;
    if (PROTECTED_NAME.test(blob.toUpperCase())) return false;
    return true;
}

(async () => {
    const extract = JSON.parse(fs.readFileSync(".tmp-unsec-excel.json", "utf8"));
    const compare = JSON.parse(fs.readFileSync(".tmp-unsec-compare.json", "utf8"));
    const canonByName = new Map(compare.map((r: any) => [r.ledger, r.canonId]));
    const stats = { relink: 0, deleted: 0, added: 0, openingsMoved: 0, headingMoved: 0 };

    const copyIdsByCanon = new Map<string, string[]>();
    for (const row of compare) {
        const ids = (row.copies as any[])
            .filter(c => c.cat === "JOURNAL" && /Unsecured|Loan From Director/i.test(c.path) && c.id !== row.canonId && c.nPer + 1 > 0)
            .map(c => c.id);
        copyIdsByCanon.set(row.canonId, ids);
    }

    // --- 1. Collapse duplicate copies: match excel across copies, relink hits, delete leftover copy extras ---
    for (const xl of extract.ledgers) {
        const canonId = canonByName.get(xl.ledger);
        if (!canonId) continue;
        const copyIds = copyIdsByCanon.get(canonId) || [];
        const allIds = [canonId, ...copyIds];
        const entries = await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: { in: allIds },
                voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: WIDE_START, lte: END } }
            },
            select: { id: true, ledgerId: true, entryType: true, amount: true, voucherId: true, voucher: { select: { voucherNo: true } } }
        });
        const used = new Set<string>();
        const byNSA = new Map<string, any[]>();
        for (const e of entries) {
            const k = `${norm(e.voucher.voucherNo)}|${e.entryType}|${cents(e.amount)}`;
            byNSA.set(k, [...(byNSA.get(k) || []), e]);
        }
        const relink: string[] = [];
        for (const row of xl.vouchers) {
            const k = `${norm(row.no)}|${row.side}|${cents(row.amount)}`;
            const hits = (byNSA.get(k) || []).filter(h => !used.has(h.id));
            const prefer = hits.find(h => h.ledgerId === canonId) || hits[0];
            if (!prefer) continue;
            used.add(prefer.id);
            if (prefer.ledgerId !== canonId) relink.push(prefer.id);
        }
        if (relink.length) {
            const values = relink.map(id => `('${id}','${canonId}')`).join(",");
            await prisma.$executeRawUnsafe(
                `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
            );
            stats.relink += relink.length;
        }
        const extras = entries.filter(e => !used.has(e.id) && e.ledgerId !== canonId);
        // Delete extras on copies (they inflate same-name TB merge). Keep voucher other lines.
        const delIds = extras.map(e => e.id);
        if (delIds.length) {
            await prisma.ledgerEntry.deleteMany({ where: { id: { in: delIds } } });
            stats.deleted += delIds.length;
        }

        // Openings on copies → canonical if canonical has none
        const canonOpen = await prisma.ledgerEntry.count({
            where: { ledgerId: canonId, voucher: { voucherType: "OPENING_BALANCE" } }
        });
        if (copyIds.length) {
            const copyOpens = await prisma.ledgerEntry.findMany({
                where: { ledgerId: { in: copyIds }, voucher: { voucherType: "OPENING_BALANCE" } },
                select: { id: true, amount: true, entryType: true }
            });
            if (!canonOpen && copyOpens.length) {
                await prisma.ledgerEntry.update({ where: { id: copyOpens[0].id }, data: { ledgerId: canonId } });
                stats.openingsMoved += 1;
                if (copyOpens.length > 1) {
                    await prisma.ledgerEntry.deleteMany({ where: { id: { in: copyOpens.slice(1).map(o => o.id) } } });
                    stats.deleted += copyOpens.length - 1;
                }
            } else if (canonOpen && copyOpens.length) {
                await prisma.ledgerEntry.deleteMany({ where: { id: { in: copyOpens.map(o => o.id) } } });
                stats.deleted += copyOpens.length;
            }
        }
    }

    // --- 2. Heading EMI principals → loan ledgers that Excel is missing ---
    const heading = await prisma.ledgerEntry.findMany({
        where: { ledgerId: HEADING_UNSEC, voucher: { voucherType: { not: "OPENING_BALANCE" } } },
        select: { id: true, amount: true, entryType: true, voucher: { select: { voucherNo: true } } }
    });
    const emiMap: Record<string, string> = {
        "124981": compare.find((r: any) => r.ledger.startsWith("POONAWALA"))?.canonId,
        "148953": compare.find((r: any) => r.ledger.startsWith("UNITY"))?.canonId,
        "150939": compare.find((r: any) => r.ledger.startsWith("UNITY"))?.canonId,
        "157057": compare.find((r: any) => r.ledger.startsWith("UNITY"))?.canonId
    };
    for (const e of heading) {
        const key = String(Number(e.amount));
        const target = emiMap[key];
        if (target && e.entryType === "DEBIT") {
            await prisma.ledgerEntry.update({ where: { id: e.id }, data: { ledgerId: target } });
            stats.headingMoved += 1;
        }
    }

    // --- 3. Remaining missing: relink stealable or add to unbalanced voucher ---
    const adds: any[] = [];
    for (const xl of extract.ledgers) {
        const canonId = canonByName.get(xl.ledger);
        if (!canonId) continue;
        const entries = await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: canonId,
                voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: WIDE_START, lte: END } }
            },
            select: { id: true, entryType: true, amount: true, voucher: { select: { voucherNo: true } } }
        });
        const used = new Set<string>();
        const byNSA = new Map<string, any[]>();
        for (const e of entries) {
            const k = `${norm(e.voucher.voucherNo)}|${e.entryType}|${cents(e.amount)}`;
            byNSA.set(k, [...(byNSA.get(k) || []), e]);
        }
        const missing: any[] = [];
        for (const row of xl.vouchers) {
            const k = `${norm(row.no)}|${row.side}|${cents(row.amount)}`;
            const hit = (byNSA.get(k) || []).find(h => !used.has(h.id));
            if (hit) used.add(hit.id);
            else missing.push(row);
        }
        // TATA 10665 split 497520+9402480 = 9900000: treat as matched if extras sum
        for (const row of [...missing]) {
            if (xl.ledger.startsWith("TATA") && cents(row.amount) === 990000000) {
                const parts = entries.filter(e => !used.has(e.id) && e.entryType === "DEBIT" && String(e.voucher.voucherNo) === String(row.no));
                const sum = parts.reduce((s, e) => s + cents(e.amount), 0);
                if (sum === cents(row.amount)) {
                    for (const p of parts) used.add(p.id);
                    missing.splice(missing.indexOf(row), 1);
                }
            }
        }

        for (const row of missing) {
            const cands = await prisma.ledgerEntry.findMany({
                where: {
                    entryType: row.side,
                    amount: row.amount,
                    voucher: { branchId: BRANCH_ID, voucherNo: String(row.no), voucherType: { not: "OPENING_BALANCE" } }
                },
                select: {
                    id: true, ledgerId: true,
                    ledger: { select: { name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } } },
                    voucher: { select: { id: true, voucherNo: true, totalDebit: true, totalCredit: true } }
                }
            });
            const steal = cands.find(e => stealOk(e) && e.ledgerId !== canonId);
            if (steal) {
                await prisma.ledgerEntry.update({ where: { id: steal.id }, data: { ledgerId: canonId } });
                stats.relink += 1;
                continue;
            }
            const vs = await prisma.voucher.findMany({
                where: { branchId: BRANCH_ID, voucherNo: String(row.no) },
                select: {
                    id: true, voucherType: true,
                    entries: { select: { entryType: true, amount: true, ledgerId: true } }
                }
            });
            let added = false;
            for (const v of vs) {
                const dr = v.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
                const cr = v.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
                const gap = dr - cr;
                const want = cents(row.amount);
                const ok =
                    (row.side === "CREDIT" && (gap === want || (cr === 0 && dr === want))) ||
                    (row.side === "DEBIT" && (gap === -want || (dr === 0 && cr === want)));
                if (!ok) continue;
                adds.push({
                    id: randomUUID(), voucherId: v.id, ledgerId: canonId, branchId: BRANCH_ID,
                    entryType: row.side, amount: row.amount,
                    narration: `Unsec recon ${row.no} ${xl.ledger}`.slice(0, 200),
                    newTotalDebit: money(dr + (row.side === "DEBIT" ? want : 0)),
                    newTotalCredit: money(cr + (row.side === "CREDIT" ? want : 0))
                });
                added = true;
                break;
            }
            if (!added && vs[0]) {
                // Add the loan side and accept voucher may already be balanced via Bank — only if particular is this loan's counterpart bank
                const host = vs.find(v => !v.entries.some(e => e.ledgerId === canonId && cents(e.amount) === cents(row.amount) && (e as any).entryType === row.side)) || vs[0];
                const dr = host.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
                const cr = host.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
                if (Math.abs(dr - cr) === cents(row.amount) || dr === cr) {
                    // if already balanced, adding would unbalance — skip unless gap matches
                    if (dr !== cr) {
                        const want = cents(row.amount);
                        adds.push({
                            id: randomUUID(), voucherId: host.id, ledgerId: canonId, branchId: BRANCH_ID,
                            entryType: row.side, amount: row.amount,
                            narration: `Unsec recon ${row.no} ${xl.ledger}`.slice(0, 200),
                            newTotalDebit: money(dr + (row.side === "DEBIT" ? want : 0)),
                            newTotalCredit: money(cr + (row.side === "CREDIT" ? want : 0))
                        });
                    }
                }
            }
        }

        // Extra on canonical that's not in excel: park only HDFC 9607 / HDFC 4385 extras noted
        const extraCanon = entries.filter(e => !used.has(e.id));
        if (xl.ledger.includes("9607") || xl.ledger.includes("4385")) {
            for (const e of extraCanon) {
                // move off unsecured merge: to heading? better delete if voucher stays balanced with other lines
                const v = await prisma.ledgerEntry.findMany({ where: { voucherId: (await prisma.ledgerEntry.findUnique({ where: { id: e.id }, select: { voucherId: true } }))!.voucherId } });
                if (v.length > 1) {
                    await prisma.ledgerEntry.delete({ where: { id: e.id } });
                    stats.deleted += 1;
                }
            }
        }
    }

    if (adds.length) {
        await prisma.ledgerEntry.createMany({
            data: adds.map(a => ({
                id: a.id, voucherId: a.voucherId, ledgerId: a.ledgerId, branchId: a.branchId,
                entryType: a.entryType, amount: a.amount, narration: a.narration
            }))
        });
        stats.added += adds.length;
        for (const a of adds) {
            await prisma.voucher.update({
                where: { id: a.voucherId },
                data: { totalDebit: a.newTotalDebit, totalCredit: a.newTotalCredit }
            });
        }
    }

    // --- 4. Create missing openings on UNITY / MAS VENDOR if still absent ---
    for (const xl of extract.ledgers) {
        if (!xl.openings?.[0]) continue;
        const canonId = canonByName.get(xl.ledger);
        if (!canonId) continue;
        const n = await prisma.ledgerEntry.count({
            where: { ledgerId: canonId, voucher: { voucherType: "OPENING_BALANCE" } }
        });
        if (n) continue;
        const op = xl.openings[0];
        const voucherId = randomUUID();
        await prisma.voucher.create({
            data: {
                id: voucherId,
                voucherNo: `OPN-UNSEC-${xl.ledger.slice(0, 8).replace(/\s/g, "").toUpperCase()}`,
                voucherType: "OPENING_BALANCE",
                sourceId: randomUUID(),
                branchId: BRANCH_ID,
                narration: `Opening balance: ${xl.ledger}`,
                voucherDate: START,
                totalDebit: op.side === "DEBIT" ? op.amount : 0,
                totalCredit: op.side === "CREDIT" ? op.amount : 0,
                entries: {
                    create: [{
                        ledgerId: canonId,
                        branchId: BRANCH_ID,
                        entryType: op.side,
                        amount: op.amount,
                        narration: `Opening ${xl.ledger}`
                    }]
                }
            }
        });
        stats.openingsMoved += 1;
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
        /Unsecured|Loan From Director/.test(x.path) && /Loans \(Liability\)/.test(x.path)
        && (x.path.split(" > ").length <= 4)
    ).map(x => ({
        path: x.path,
        od: x.node.openingDebit, oc: x.node.openingCredit,
        pd: x.node.periodDebit, pc: x.node.periodCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));

    const pdf = {
        parent: { oc: 194220007.32, cc: 209169654.45 },
        directors: { oc: 23586838.62, cc: 21758069.62 },
        fromBank: { oc: 5669384.98, cc: 86783560.99 },
        fromOther: { oc: 101146121.22, cc: 100628023.84 }
    };
    console.log(JSON.stringify({ stats, adds: adds.length, pdf, tb }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
