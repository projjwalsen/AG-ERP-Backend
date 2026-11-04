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
const CANON_BOM = "8faa06f2-6b04-404e-8729-1cc3dd5d073b";
const CANON_BOB = "9b5650be-5530-4401-8515-933dda455174";
const NESTED_BOB = "dc58112c-b8ea-4845-a598-c1cdffc44d6b";
const BANK_ACCOUNTS_ID = "7cf41220-8e89-4cd1-b6ce-e7bac996abd6";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();
const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const xlType = (t: string) => {
    const n = norm(t);
    if (n === "CONTRA") return "CONTRA";
    if (n.includes("RECEIPT")) return "RECEIPT";
    if (n.includes("PAYMENT") || n.includes("SALARY")) return "PAYMENT";
    if (n === "JOURNAL") return "JOURNAL";
    return n;
};
const ALLOWED_BANK = new Set([
    "FD WITH BOM 60481155324", "FD WITH BOM 60522865556", "FD WITH YES BANK 024840600029570",
    "KARNATAKA BANK FD AC NO - 5201500202002401", "KARNATAKA BANK FD AC NO - 5201500202009301",
    "KARNATAKA BANK FD AC NO - 5201500202084001", "BOM CA 60435349267", "CENTRAL BANK - 3224976293",
    "YES BANK CA - 024863700003291", "KARNATAKA CA 5207000300027101"
]);
const PROTECTED = /SUNDRY CREDITOR|SUNDRY DEBTOR|DUTIES|TDS ON |TCS ON |INPUT CGST|INPUT SGST|INPUT IGST|OUTPUT CGST|OUTPUT SGST|OUTPUT IGST/;

function stealScore(e: any, row: any) {
    const name = norm(e.ledger.name);
    const group = norm(e.ledger.group?.name);
    const parent = norm(e.ledger.group?.parent?.name);
    const blob = `${name} ${group} ${parent}`;
    if (e.ledger.category === "CUSTOMER" || e.ledger.category === "VENDOR") return -100;
    if (PROTECTED.test(blob) && !/BANK OF MAHARASHTRA|BANK OF BARODA|BANK ACCOUNTS/.test(name)) return -100;
    if (/BANK CHARGES/.test(name) && e.entryType === "DEBIT") return -80;
    let s = 0;
    if (xlType(e.voucher.voucherType) === xlType(row.type)) s += 6;
    if (name === "BANK ACCOUNTS") s += 10;
    if (e.ledger.category === "BANK" && !ALLOWED_BANK.has(name)) s += 8;
    if (group === "BANK ACCOUNTS") s += 3;
    if (name === "BANK OF MAHARASHTRA") s += 6;
    if (localDate(e.voucher.voucherDate) === row.date) s += 2;
    if (ALLOWED_BANK.has(name) && xlType(row.type) === "CONTRA") s += 5;
    if (ALLOWED_BANK.has(name) && xlType(row.type) !== "CONTRA") s -= 15;
    return s;
}

async function refreshLedgers(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    for (let i = 0; i < unique.length; i += 200) {
        const chunk = unique.slice(i, i + 200);
        const inList = chunk.map(id => `'${id}'`).join(",");
        await prisma.$executeRawUnsafe(`
            WITH ledgers AS (
                SELECT l.id,
                    CASE WHEN l."openingDebit" <> 0 OR l."openingCredit" <> 0
                        THEN l."openingDebit" - l."openingCredit"
                        ELSE CASE WHEN l.nature = 'CREDIT' THEN -l."openingBalance" ELSE l."openingBalance" END
                    END AS opening
                FROM "Ledger" l
                WHERE l.id IN (${inList})
            ),
            entries AS (
                SELECT e."ledgerId",
                    SUM(CASE WHEN e."entryType" = 'DEBIT' THEN e.amount ELSE -e.amount END) AS net
                FROM "LedgerEntry" e
                WHERE e."ledgerId" IN (${inList})
                GROUP BY e."ledgerId"
            )
            UPDATE "Ledger" l
            SET "currentBalance" = ledgers.opening + COALESCE(entries.net, 0),
                "updatedAt" = NOW()
            FROM ledgers
            LEFT JOIN entries ON entries."ledgerId" = ledgers.id
            WHERE l.id = ledgers.id
        `);
    }
}

(async () => {
    const bomXl = JSON.parse(fs.readFileSync(".tmp-odcc-bom.json", "utf8"));
    const backup: any = { relink: [], flips: [], adds: [], parks: [], dates: [], bob: {} };

    const bomEntries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: BOM_IDS },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: WIDE_START, lte: END } }
        },
        select: {
            id: true, ledgerId: true, entryType: true, amount: true, voucherId: true,
            voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } }
        }
    });

    type Hit = { id: string; no: string; side: string; cents: number; date: string; type: string; ledgerId: string; voucherId: true | string; rawType: string; voucherDate: Date };
    const hits: Hit[] = bomEntries.map(e => ({
        id: e.id, no: norm(e.voucher.voucherNo), side: e.entryType, cents: cents(e.amount),
        date: localDate(e.voucher.voucherDate), type: xlType(e.voucher.voucherType),
        rawType: e.voucher.voucherType, ledgerId: e.ledgerId, voucherId: e.voucherId,
        voucherDate: e.voucher.voucherDate
    }));
    const used = new Set<string>();
    const byNTSA = new Map<string, Hit[]>();
    const byNSA = new Map<string, Hit[]>();
    const push = (m: Map<string, Hit[]>, k: string, h: Hit) => { const a = m.get(k) || []; a.push(h); m.set(k, a); };
    for (const h of hits) {
        push(byNTSA, `${h.no}|${h.type}|${h.side}|${h.cents}`, h);
        push(byNSA, `${h.no}|${h.side}|${h.cents}`, h);
    }
    const prefer = (arr: Hit[], date?: string) => {
        const free = arr.filter(h => !used.has(h.id));
        if (date) {
            const same = free.filter(h => h.date === date);
            if (same.length) return same[0];
        }
        return free[0];
    };

    const missing: any[] = [];
    for (const row of bomXl.vouchers) {
        const no = norm(row.no);
        const type = xlType(row.type);
        const amt = cents(row.amount);
        let hit = prefer(byNTSA.get(`${no}|${type}|${row.side}|${amt}`) || [], row.date);
        if (!hit) hit = prefer(byNSA.get(`${no}|${row.side}|${amt}`) || [], row.date);
        if (hit) {
            used.add(hit.id);
            if (row.date === "2025-04-01" && hit.date === "2025-03-31") {
                backup.dates.push({ voucherId: hit.voucherId, from: hit.voucherDate, to: START.toISOString(), no: row.no });
            }
            continue;
        }
        missing.push(row);
    }
    const extras = hits.filter(h => !used.has(h.id));

    const missNos = [...new Set(missing.map((r: any) => String(r.no)))];
    const candidates: any[] = [];
    for (let i = 0; i < missNos.length; i += 80) {
        const chunk = missNos.slice(i, i + 80);
        const rows = await prisma.ledgerEntry.findMany({
            where: {
                voucher: { branchId: BRANCH_ID, voucherNo: { in: chunk }, voucherType: { not: "OPENING_BALANCE" } }
            },
            select: {
                id: true, ledgerId: true, entryType: true, amount: true, voucherId: true,
                ledger: { select: { name: true, category: true, group: { select: { name: true, parent: { select: { name: true } } } } } },
                voucher: { select: { id: true, voucherNo: true, voucherType: true, voucherDate: true, totalDebit: true, totalCredit: true, narration: true } }
            }
        });
        candidates.push(...rows);
    }

    const usedCand = new Set<string>();
    const still: any[] = [];
    for (const row of missing) {
        const amt = cents(row.amount);
        const ranked = candidates
            .filter(e =>
                !usedCand.has(e.id) &&
                !used.has(e.id) &&
                !BOM_IDS.includes(e.ledgerId) &&
                !BOB_IDS.includes(e.ledgerId) &&
                norm(e.voucher.voucherNo) === norm(row.no) &&
                e.entryType === row.side &&
                cents(e.amount) === amt
            )
            .map(e => ({ e, score: stealScore(e, row) }))
            .filter(x => x.score >= 4)
            .sort((a, b) => b.score - a.score);
        if (ranked[0]) {
            usedCand.add(ranked[0].e.id);
            backup.relink.push({
                entryId: ranked[0].e.id,
                from: ranked[0].e.ledgerId,
                fromName: ranked[0].e.ledger.name,
                to: CANON_BOM,
                no: row.no, side: row.side, amount: row.amount, score: ranked[0].score
            });
            if (row.date === "2025-04-01" && localDate(ranked[0].e.voucher.voucherDate) === "2025-03-31") {
                backup.dates.push({ voucherId: ranked[0].e.voucherId, from: ranked[0].e.voucher.voucherDate, to: START.toISOString(), no: row.no });
            }
        } else {
            still.push(row);
        }
    }

    // Flip extras that match a still-missing row on the opposite side
    const stillLeft: any[] = [];
    const extraLeft = extras.filter(h => !used.has(h.id));
    const extraUsed = new Set<string>();
    for (const row of still) {
        const amt = cents(row.amount);
        const flip = extraLeft.find(h =>
            !extraUsed.has(h.id) &&
            h.no === norm(row.no) &&
            h.cents === amt &&
            h.side !== row.side
        );
        if (flip) {
            extraUsed.add(flip.id);
            used.add(flip.id);
            backup.flips.push({ entryId: flip.id, from: flip.side, to: row.side, no: row.no, amount: row.amount });
        } else {
            stillLeft.push(row);
        }
    }
    const trueExtras = extraLeft.filter(h => !extraUsed.has(h.id) && !used.has(h.id));

    // Add missing BOM lines on unbalanced vouchers where the gap equals the excel amount
    const vouchersByNo = new Map<string, any[]>();
    for (const e of candidates) {
        const k = norm(e.voucher.voucherNo);
        const arr = vouchersByNo.get(k) || [];
        if (!arr.some(v => v.id === e.voucher.id)) arr.push(e.voucher);
        vouchersByNo.set(k, arr);
    }
    const still2: any[] = [];
    const addVoucherIds = new Set<string>();
    for (const row of stillLeft) {
        const vs = (vouchersByNo.get(norm(row.no)) || []).filter(v => xlType(v.voucherType) === xlType(row.type) || true);
        const dated = vs.filter(v => localDate(v.voucherDate) === row.date);
        const pool = dated.length ? dated : vs;
        let added = false;
        for (const v of pool) {
            if (addVoucherIds.has(v.id)) continue;
            const lines = candidates.filter(e => e.voucherId === v.id);
            const dr = lines.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
            const cr = lines.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
            const hasBom = lines.some(e => BOM_IDS.includes(e.ledgerId) || BOB_IDS.includes(e.ledgerId));
            const gap = dr - cr;
            const want = cents(row.amount);
            const wantSide = row.side;
            const gapMatches =
                (wantSide === "CREDIT" && gap === want) ||
                (wantSide === "DEBIT" && gap === -want) ||
                (wantSide === "CREDIT" && cr === 0 && dr === want) ||
                (wantSide === "DEBIT" && dr === 0 && cr === want);
            if (!hasBom && gapMatches) {
                backup.adds.push({
                    id: randomUUID(),
                    voucherId: v.id,
                    ledgerId: CANON_BOM,
                    entryType: wantSide,
                    amount: row.amount,
                    narration: `OD/CC recon ${row.no} ${row.particular || ""}`.slice(0, 200),
                    no: row.no,
                    newTotalDebit: money(dr + (wantSide === "DEBIT" ? want : 0)),
                    newTotalCredit: money(cr + (wantSide === "CREDIT" ? want : 0))
                });
                addVoucherIds.add(v.id);
                added = true;
                break;
            }
        }
        if (!added) still2.push(row);
    }

    // Park true extras onto generic Bank Accounts (keep voucher balanced, remove from BOM)
    for (const h of trueExtras) {
        backup.parks.push({
            entryId: h.id,
            from: h.ledgerId,
            to: BANK_ACCOUNTS_ID,
            no: h.no, side: h.side, amount: money(h.cents), type: h.rawType
        });
    }

    // BOB opening + 18116
    const bobOpening = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: BOB_IDS }, voucher: { voucherType: "OPENING_BALANCE" } },
        select: {
            id: true, ledgerId: true, amount: true, entryType: true, voucherId: true,
            voucher: { select: { voucherNo: true, entries: { select: { id: true, ledgerId: true, entryType: true, amount: true } } } }
        }
    });
    backup.bob.openings = bobOpening;
    const v18116 = await prisma.voucher.findFirst({
        where: { branchId: BRANCH_ID, voucherNo: "18116" },
        select: {
            id: true, voucherType: true, totalDebit: true, totalCredit: true, narration: true,
            entries: { select: { id: true, ledgerId: true, entryType: true, amount: true, ledger: { select: { name: true } } } }
        }
    });
    backup.bob.v18116 = v18116;
    const has18116Bom = (v18116?.entries || []).some(e => BOB_IDS.includes(e.ledgerId) && e.entryType === "CREDIT" && cents(e.amount) === 300900);
    if (v18116 && !has18116Bom) {
        backup.bob.add18116 = {
            id: randomUUID(),
            voucherId: v18116.id,
            ledgerId: CANON_BOB,
            entryType: "CREDIT",
            amount: 3009,
            narration: v18116.narration,
            newTotalCredit: money(cents(v18116.totalCredit) + 300900)
        };
    }

    fs.writeFileSync(".tmp-odcc-apply-backup.json", JSON.stringify({
        relink: backup.relink.length,
        flips: backup.flips.length,
        adds: backup.adds.length,
        parks: backup.parks.length,
        dates: backup.dates.length,
        still2: still2.length,
        still2ByType: still2.reduce((a: any, r: any) => {
            a[r.type] = a[r.type] || { n: 0, dr: 0, cr: 0 };
            a[r.type].n += 1;
            if (r.side === "DEBIT") a[r.type].dr += r.amount; else a[r.type].cr += r.amount;
            return a;
        }, {}),
        still2Sample: still2.slice(0, 15),
        parkSample: backup.parks.slice(0, 10),
        bob: { openings: backup.bob.openings.length, add18116: !!backup.bob.add18116 }
    }, null, 2));

    // APPLY
    for (let i = 0; i < backup.relink.length; i += 200) {
        const chunk = backup.relink.slice(i, i + 200);
        const values = chunk.map((r: any) => `('${r.entryId}','${r.to}')`).join(",");
        await prisma.$executeRawUnsafe(
            `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
        );
    }
    for (const f of backup.flips) {
        await prisma.ledgerEntry.update({ where: { id: f.entryId }, data: { entryType: f.to } });
    }
    if (backup.adds.length) {
        await prisma.ledgerEntry.createMany({
            data: backup.adds.map((a: any) => ({
                id: a.id,
                voucherId: a.voucherId,
                ledgerId: a.ledgerId,
                branchId: BRANCH_ID,
                entryType: a.entryType,
                amount: a.amount,
                narration: a.narration
            }))
        });
        for (const a of backup.adds) {
            await prisma.voucher.update({
                where: { id: a.voucherId },
                data: { totalDebit: a.newTotalDebit, totalCredit: a.newTotalCredit }
            });
        }
    }
    for (let i = 0; i < backup.parks.length; i += 200) {
        const chunk = backup.parks.slice(i, i + 200);
        const values = chunk.map((r: any) => `('${r.entryId}','${r.to}')`).join(",");
        if (!values) continue;
        await prisma.$executeRawUnsafe(
            `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
        );
    }
    const dateIds = [...new Set(backup.dates.map((d: any) => d.voucherId))];
    if (dateIds.length) {
        await prisma.voucher.updateMany({
            where: { id: { in: dateIds } },
            data: { voucherDate: START }
        });
    }

    for (const op of bobOpening) {
        if (op.ledgerId === NESTED_BOB || op.ledgerId === CANON_BOB) {
            const others = op.voucher.entries.filter(e => e.id !== op.id);
            await prisma.ledgerEntry.delete({ where: { id: op.id } });
            if (!others.length) {
                await prisma.journal.deleteMany({ where: { voucherId: op.voucherId } });
                await prisma.voucher.delete({ where: { id: op.voucherId } }).catch(() => {});
            }
        }
    }
    if (backup.bob.add18116) {
        const a = backup.bob.add18116;
        await prisma.ledgerEntry.create({
            data: {
                id: a.id,
                voucherId: a.voucherId,
                ledgerId: a.ledgerId,
                branchId: BRANCH_ID,
                entryType: a.entryType,
                amount: a.amount,
                narration: a.narration
            }
        });
        await prisma.voucher.update({
            where: { id: a.voucherId },
            data: { totalCredit: a.newTotalCredit }
        });
    }

    fs.writeFileSync(".tmp-odcc-apply-full.json", JSON.stringify(backup));

    await refreshLedgers([
        ...BOM_IDS, ...BOB_IDS, BANK_ACCOUNTS_ID,
        ...backup.relink.map((r: any) => r.from),
        ...backup.parks.map((p: any) => p.from)
    ]);

    // Rematch after apply
    const after = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: BOM_IDS },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: { id: true, entryType: true, amount: true, voucher: { select: { voucherNo: true, voucherType: true, voucherDate: true } } }
    });
    const used2 = new Set<string>();
    const by2 = new Map<string, string[]>();
    for (const e of after) {
        const k = `${norm(e.voucher.voucherNo)}|${e.entryType}|${cents(e.amount)}`;
        by2.set(k, [...(by2.get(k) || []), e.id]);
    }
    let matched2 = 0;
    const miss2: any[] = [];
    for (const row of bomXl.vouchers) {
        const k = `${norm(row.no)}|${row.side}|${cents(row.amount)}`;
        const ids = (by2.get(k) || []).filter(id => !used2.has(id));
        if (ids[0]) { used2.add(ids[0]); matched2 += 1; }
        else miss2.push(row);
    }
    const extra2 = after.filter(e => !used2.has(e.id));
    let dr = 0, cr = 0;
    for (const e of after) {
        if (e.entryType === "DEBIT") dr += cents(e.amount); else cr += cents(e.amount);
    }
    const bobAfter = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: BOB_IDS },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: { entryType: true, amount: true, voucher: { select: { voucherNo: true } } }
    });
    let bobDr = 0, bobCr = 0;
    for (const e of bobAfter) {
        if (e.entryType === "DEBIT") bobDr += cents(e.amount); else bobCr += cents(e.amount);
    }
    const openingsAfter = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: [...BOM_IDS, ...BOB_IDS] }, voucher: { voucherType: "OPENING_BALANCE" } },
        select: { ledgerId: true, entryType: true, amount: true, ledger: { select: { name: true } } }
    });

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH_ID, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const hitsTb = walk(report.tree || []).filter(x =>
        /bank od|60434886441|13780500000078/i.test(x.path + " " + x.node.name)
    );

    console.log(JSON.stringify({
        applied: {
            relink: backup.relink.length, flips: backup.flips.length, adds: backup.adds.length,
            parks: backup.parks.length, dates: dateIds.length, stillBeforeSecond: still2.length
        },
        bomAfter: {
            n: after.length, dr: money(dr), cr: money(cr),
            excelDr: bomXl.perDr, excelCr: bomXl.perCr,
            dDr: money(dr - cents(bomXl.perDr)), dCr: money(cr - cents(bomXl.perCr)),
            matched: matched2, missing: miss2.length, extra: extra2.length,
            missSample: miss2.slice(0, 8),
            extraSample: extra2.slice(0, 8).map(e => ({ no: e.voucher.voucherNo, type: e.voucher.voucherType, side: e.entryType, amount: Number(e.amount) }))
        },
        bobAfter: {
            n: bobAfter.length, dr: money(bobDr), cr: money(bobCr), nos: bobAfter.map(e => e.voucher.voucherNo)
        },
        openingsAfter,
        tb: hitsTb.map(x => ({
            path: x.path,
            od: x.node.openingDebit, oc: x.node.openingCredit,
            pd: x.node.periodDebit, pc: x.node.periodCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit
        }))
    }, null, 2));
    fs.writeFileSync(".tmp-odcc-still-after.json", JSON.stringify({ miss2, extra2: extra2.map(e => ({ id: e.id, no: e.voucher.voucherNo, type: e.voucher.voucherType, side: e.entryType, amount: Number(e.amount) })) }));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
