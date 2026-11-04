import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();

(async () => {
    const ledgers = await prisma.ledger.findMany({
        where: {
            OR: [
                { name: { contains: "60434886441", mode: "insensitive" } },
                { name: { contains: "13780500000078", mode: "insensitive" } },
                { name: { contains: "BANK OF BARODA", mode: "insensitive" } },
                { name: { contains: "BANK OF MAHARASHTRA- C/C", mode: "insensitive" } },
                { name: { contains: "Bank OD", mode: "insensitive" } }
            ]
        },
        select: {
            id: true, name: true, category: true, nature: true, isActive: true, branchId: true,
            openingDebit: true, openingCredit: true, openingBalance: true,
            group: { select: { id: true, name: true, code: true, parent: { select: { name: true, parent: { select: { name: true } } } } } }
        }
    });
    const groups = await prisma.ledgerGroup.findMany({
        where: { name: { contains: "OD", mode: "insensitive" } },
        select: { id: true, name: true, code: true, parent: { select: { name: true, parent: { select: { name: true } } } } }
    });

    const sums = [];
    for (const l of ledgers) {
        const entries = await prisma.ledgerEntry.findMany({
            where: { ledgerId: l.id },
            select: {
                entryType: true, amount: true,
                voucher: { select: { voucherType: true, voucherDate: true, branchId: true } }
            }
        });
        let openDr = 0, openCr = 0, perDr = 0, perCr = 0, nOpen = 0, nPer = 0;
        const types: Record<string, number> = {};
        for (const e of entries) {
            const amt = cents(e.amount);
            types[e.voucher.voucherType] = (types[e.voucher.voucherType] || 0) + 1;
            if (e.voucher.branchId && e.voucher.branchId !== BRANCH_ID) continue;
            if (e.voucher.voucherType === "OPENING_BALANCE") {
                nOpen += 1;
                if (e.entryType === "DEBIT") openDr += amt; else openCr += amt;
            } else if (e.voucher.voucherDate >= START && e.voucher.voucherDate <= END) {
                nPer += 1;
                if (e.entryType === "DEBIT") perDr += amt; else perCr += amt;
            }
        }
        sums.push({
            id: l.id, name: l.name, category: l.category, nature: l.nature, active: l.isActive,
            group: `${l.group?.parent?.parent?.name || ""} > ${l.group?.parent?.name || ""} > ${l.group?.name}`,
            groupCode: l.group?.code,
            ledgerOpenDr: Number(l.openingDebit), ledgerOpenCr: Number(l.openingCredit),
            openDr: money(openDr), openCr: money(openCr), nOpen,
            perDr: money(perDr), perCr: money(perCr), nPer, types
        });
    }

    const report = await ReportingService.getTrialBalanceReport(
        { id: "c7feaec8-d19f-480b-8bf3-036745415849", branchAccessType: "ALL" },
        { branchId: BRANCH_ID, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(report.tree || []);
    const hits = all.filter(x =>
        /bank od|cc a\/c|60434886441|13780500000078|bank of baroda|bank of maharashtra- c\/c/i.test(x.path + " " + x.node.name)
    );
    console.log(JSON.stringify({
        groups,
        ledgers: sums,
        tbHits: hits.map(x => ({
            path: x.path,
            od: x.node.openingDebit, oc: x.node.openingCredit,
            pd: x.node.periodDebit, pc: x.node.periodCredit,
            cd: x.node.closingDebit, cc: x.node.closingCredit,
            children: (x.node.children || []).map((c: any) => c.name)
        }))
    }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
