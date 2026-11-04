import "dotenv/config";
import * as fs from "fs";
import { prisma } from "./src/config/db";

const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();

(async () => {
    const extract = JSON.parse(fs.readFileSync(".tmp-unsec-excel.json", "utf8"));
    const compare = JSON.parse(fs.readFileSync(".tmp-unsec-compare.json", "utf8"));
    const names = extract.ledgers.map((l: any) => l.ledger);

    const groups = await prisma.ledgerGroup.findMany({
        where: { name: { in: names, mode: "insensitive" } },
        select: {
            id: true, name: true,
            parent: { select: { name: true, parent: { select: { name: true } } } },
            ledgers: { select: { id: true, name: true, category: true } }
        }
    });

    const allLedgers = await prisma.ledger.findMany({
        where: { name: { in: names, mode: "insensitive" } },
        select: {
            id: true, name: true, category: true, groupId: true,
            group: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } }
        }
    });

    const ids = allLedgers.map(l => l.id);
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: ids },
            voucher: { voucherType: { not: "OPENING_BALANCE" }, voucherDate: { gte: START, lte: END } }
        },
        select: { ledgerId: true, entryType: true, amount: true }
    });
    const openings = await prisma.ledgerEntry.findMany({
        where: { ledgerId: { in: ids }, voucher: { voucherType: "OPENING_BALANCE" } },
        select: { ledgerId: true, entryType: true, amount: true }
    });
    const per = new Map<string, { n: number; dr: number; cr: number }>();
    for (const e of entries) {
        const cur = per.get(e.ledgerId) || { n: 0, dr: 0, cr: 0 };
        cur.n += 1;
        if (e.entryType === "DEBIT") cur.dr += cents(e.amount); else cur.cr += cents(e.amount);
        per.set(e.ledgerId, cur);
    }
    const op = new Map<string, { n: number; dr: number; cr: number }>();
    for (const e of openings) {
        const cur = op.get(e.ledgerId) || { n: 0, dr: 0, cr: 0 };
        cur.n += 1;
        if (e.entryType === "DEBIT") cur.dr += cents(e.amount); else cur.cr += cents(e.amount);
        op.set(e.ledgerId, cur);
    }

    const byName = new Map<string, typeof allLedgers>();
    for (const l of allLedgers) {
        const k = norm(l.name);
        byName.set(k, [...(byName.get(k) || []), l]);
    }

    const rows = [];
    for (const xl of extract.ledgers) {
        const cmp = compare.find((r: any) => r.ledger === xl.ledger);
        const copies = byName.get(norm(xl.ledger)) || [];
        const copyRows = copies.map(c => {
            const p = per.get(c.id) || { n: 0, dr: 0, cr: 0 };
            const o = op.get(c.id) || { n: 0, dr: 0, cr: 0 };
            return {
                id: c.id,
                cat: c.category,
                path: `${c.group?.parent?.parent?.name || ""} > ${c.group?.parent?.name || ""} > ${c.group?.name}`,
                n: p.n, dr: money(p.dr), cr: money(p.cr),
                oN: o.n, oDr: money(o.dr), oCr: money(o.cr),
                canon: c.id === cmp?.canonId
            };
        });
        const journalUnsec = copyRows.filter(c => c.cat === "JOURNAL" && /Unsecured|Loan From Director|Loans \(Liability\)/i.test(c.path));
        const sumDr = journalUnsec.reduce((s, c) => s + cents(c.dr), 0);
        const sumCr = journalUnsec.reduce((s, c) => s + cents(c.cr), 0);
        const namedGroups = groups.filter(g => norm(g.name) === norm(xl.ledger)).map(g => ({
            id: g.id,
            path: `${g.parent?.parent?.name || ""} > ${g.parent?.name || ""} > ${g.name}`,
            children: g.ledgers.map(l => l.name)
        }));
        rows.push({
            ledger: xl.ledger,
            excel: { dr: xl.perDr, cr: xl.perCr },
            canonId: cmp?.canonId,
            copies: copyRows,
            mergeDr: money(sumDr),
            mergeCr: money(sumCr),
            extraMergeDr: money(sumDr - cents(xl.perDr)),
            extraMergeCr: money(sumCr - cents(xl.perCr)),
            namedGroups
        });
    }

    const hot = rows.filter(r => Math.abs(r.extraMergeDr) > 1 || Math.abs(r.extraMergeCr) > 1 || r.namedGroups.length);
    console.log(JSON.stringify({
        hotCount: hot.length,
        hot: hot.map(r => ({
            ledger: r.ledger,
            excel: r.excel,
            mergeDr: r.mergeDr,
            mergeCr: r.mergeCr,
            extraMergeDr: r.extraMergeDr,
            extraMergeCr: r.extraMergeCr,
            copies: r.copies,
            namedGroups: r.namedGroups
        })),
        missingHosts: {
            pdn: await prisma.voucher.findMany({
                where: { voucherNo: { contains: "PDN/M/2526/002" } },
                select: { id: true, voucherNo: true, voucherType: true, voucherDate: true, branchId: true }
            }),
            p12444: await prisma.voucher.findMany({
                where: { branchId: "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb", voucherNo: "12444" },
                select: {
                    id: true, voucherNo: true, voucherType: true, voucherDate: true,
                    totalDebit: true, totalCredit: true,
                    entries: { select: { entryType: true, amount: true, ledger: { select: { name: true, id: true } } } }
                }
            }),
            p10646: await prisma.voucher.findMany({
                where: { branchId: "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb", voucherNo: "10646" },
                select: {
                    id: true, voucherType: true, totalDebit: true, totalCredit: true,
                    entries: { select: { entryType: true, amount: true, ledger: { select: { name: true } } } }
                }
            })
        }
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
