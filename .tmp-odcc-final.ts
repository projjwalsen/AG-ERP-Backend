import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BOM_IDS = ["c1f62a06-f402-4b4c-a2b3-1dc3cb31c0b5", "8faa06f2-6b04-404e-8729-1cc3dd5d073b"];
const BOB_IDS = ["dc58112c-b8ea-4845-a598-c1cdffc44d6b", "9b5650be-5530-4401-8515-933dda455174"];
const BANK_ACCOUNTS_ID = "7cf41220-8e89-4cd1-b6ce-e7bac996abd6";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const p12101 = await prisma.voucher.findFirst({
        where: { id: "f979ac27-62a6-46ff-9345-bb6447fbba76" },
        select: { id: true, entries: { select: { entryType: true, amount: true } } }
    });
    if (p12101) {
        const dr = p12101.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const cr = p12101.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        await prisma.voucher.update({ where: { id: p12101.id }, data: { totalDebit: money(dr), totalCredit: money(cr) } });
    }
    const j12101 = await prisma.voucher.findFirst({
        where: { id: "4e8cc091-5658-4d30-82a3-d30052a2f559" },
        select: { id: true, entries: { select: { entryType: true, amount: true } } }
    });
    if (j12101) {
        const dr = j12101.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const cr = j12101.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        await prisma.voucher.update({ where: { id: j12101.id }, data: { totalDebit: money(dr), totalCredit: money(cr) } });
    }
    const pay17982 = await prisma.voucher.findFirst({
        where: { id: "13566f62-72dc-4ad2-8162-691ed3f3df5e" }
    });
    if (pay17982) {
        await prisma.voucher.update({
            where: { id: pay17982.id },
            data: { voucherDate: new Date("2026-03-28T18:30:00.000Z") }
        });
    }

    const unique = [...new Set([...BOM_IDS, ...BOB_IDS, BANK_ACCOUNTS_ID])];
    const inList = unique.map(id => `'${id}'`).join(",");
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
        /Bank OD A\/c|60434886441|13780500000078|Sundry Creditors$|Duties & Taxes$/.test(x.path)
    ).map(x => ({
        path: x.path,
        od: x.node.openingDebit, oc: x.node.openingCredit,
        pd: x.node.periodDebit, pc: x.node.periodCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));
    const expected = {
        odHead: { oc: 302852776.8, pd: 8420134222.96, pc: 8433299405.15, cc: 316017958.99 },
        bom: { oc: 302852776.8, pd: 8419216588.96, pc: 8432381771.15, cc: 316017958.99 },
        bob: { pd: 917634, pc: 917634, cc: 0, cd: 0 }
    };
    console.log(JSON.stringify({ tb, expected }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
