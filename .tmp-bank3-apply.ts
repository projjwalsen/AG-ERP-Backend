import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTIVE_CB = "d3dc36a5-f716-4bb5-b97d-c43b5cbcab9b";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

async function retotal(voucherId: string) {
    const v = await prisma.voucher.findUnique({
        where: { id: voucherId },
        select: { entries: { select: { entryType: true, amount: true } } }
    });
    if (!v) return;
    const dr = v.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
    const cr = v.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
    await prisma.voucher.update({ where: { id: voucherId }, data: { totalDebit: money(dr), totalCredit: money(cr) } });
}

async function deleteIfEmpty(voucherId: string) {
    const v = await prisma.voucher.findUnique({
        where: { id: voucherId },
        select: { entries: { select: { id: true } }, journals: { select: { id: true } } }
    });
    if (!v) return;
    if (v.entries.length) {
        await retotal(voucherId);
        return;
    }
    if (v.journals.length) {
        await prisma.journal.deleteMany({ where: { id: { in: v.journals.map(j => j.id) } } });
    }
    await prisma.voucher.delete({ where: { id: voucherId } });
}

const BOM_GAPS = [
    { paymentEntry: "03b33616-dbf5-4420-a437-77233161d752", want: 459037, move: ["22fc6d25-daaa-438e-8f08-84b0e1da8928"] },
    { paymentEntry: "aeee5ec0-286b-4de1-b3cf-506d6e0d9602", want: 45201, move: ["f768d5d6-fa24-43bf-8710-a721c63c0824"] },
    { paymentEntry: "7804964c-e7d2-4b55-85fc-aac4f9d0addc", want: 59625, move: ["ca737ff1-42a5-415e-aadf-733048945ccc"] },
    { paymentEntry: "5d052045-e701-4968-bc36-f8806cfde7fc", want: 42650, move: ["ff8fb248-818a-47a0-b832-e0761cbff2ca"] },
    { paymentEntry: "8252b9c3-cfda-4299-88ec-c2c3a6fe3d97", want: 59625, move: ["488848b4-14f2-4ffb-ad09-f1f49258e538"] },
    { paymentEntry: "72bc9776-6398-4064-96d4-5a2c631a3a2a", want: 42650, move: ["87cac741-8667-45ac-a330-4082bf32b73f"] },
    { paymentEntry: "b5386f81-2f62-477a-82d7-fce4b16a45fa", want: 460537, move: ["bac5c7b4-b54d-4ec9-bce1-cb396f5eb10a", "f5854894-cfb7-445f-9ac5-ceba66f5364c"] },
    { paymentEntry: "28fa436b-2ca3-410f-9eb7-6ca4b7213b7f", want: 59625, move: ["fddd2129-2792-4d0d-b57e-c21e50a90340"] },
    { paymentEntry: "aa3f6c4f-7b4c-4fc3-8112-f1278fdab8bd", want: 45201, move: ["da9816ca-189a-4749-9fc3-69137ed82399"] }
];

(async () => {
    const stats = {
        relinkedCb: 0,
        moved: 0,
        bomUpdated: 0,
        deletedVouchers: [] as string[]
    };

    // Central Bank: put PDF lines on the active ledger.
    const cbRelink = [
        "cd4ee163-84f4-49e2-baf6-ce60835a618c", // 13784 Cr 0.57
        "b8656bca-dc42-4214-9da4-b96995a84d85", // 17209 Dr 0.11
        "9338715f-fc51-4d54-b7ef-1e2c5910fa96"  // 8908 Cr 51713
    ];
    const relinkRows = await prisma.ledgerEntry.findMany({
        where: { id: { in: cbRelink } },
        select: { id: true, voucherId: true }
    });
    if (relinkRows.length) {
        await prisma.ledgerEntry.updateMany({
            where: { id: { in: relinkRows.map(r => r.id) } },
            data: { ledgerId: ACTIVE_CB }
        });
        stats.relinkedCb = relinkRows.length;
    }

    const odCb = await prisma.ledgerEntry.findUnique({
        where: { id: "6391a84a-234d-43cc-92d6-d57d26989b5b" },
        select: { id: true, voucherId: true }
    });
    const cb8908 = await prisma.ledgerEntry.findUnique({
        where: { id: "9338715f-fc51-4d54-b7ef-1e2c5910fa96" },
        select: { id: true, voucherId: true }
    });
    if (odCb && cb8908 && odCb.voucherId !== cb8908.voucherId) {
        const from = odCb.voucherId;
        await prisma.ledgerEntry.update({ where: { id: odCb.id }, data: { voucherId: cb8908.voucherId } });
        stats.moved += 1;
        await retotal(cb8908.voucherId);
        await deleteIfEmpty(from);
        stats.deletedVouchers.push("CB-CONTRA-OD-moved");
    }
    const extraCb = await prisma.ledgerEntry.findUnique({
        where: { id: "c6ee5d31-2bdf-4ffc-bde7-8016343b9432" },
        select: { id: true, voucherId: true }
    });
    if (extraCb) {
        const from = extraCb.voucherId;
        await prisma.ledgerEntry.delete({ where: { id: extraCb.id } });
        await deleteIfEmpty(from);
        stats.deletedVouchers.push("CB-CONTRA-credit");
    }

    // Karnataka FD: keep PDF 14080 credit, move the OD debit onto that voucher, drop duplicate contra credit.
    const fd14080 = await prisma.ledgerEntry.findUnique({
        where: { id: "ebecbb1e-8a5d-4e1a-9b63-2812dc5113bb" },
        select: { id: true, voucherId: true }
    });
    const odFd = await prisma.ledgerEntry.findUnique({
        where: { id: "3c246be2-e213-40a7-8d9a-fc4fda1d6e4c" },
        select: { id: true, voucherId: true }
    });
    if (fd14080 && odFd && odFd.voucherId !== fd14080.voucherId) {
        const from = odFd.voucherId;
        await prisma.ledgerEntry.update({ where: { id: odFd.id }, data: { voucherId: fd14080.voucherId } });
        stats.moved += 1;
        await retotal(fd14080.voucherId);
        await deleteIfEmpty(from);
        stats.deletedVouchers.push("KFD-CONTRA-OD-moved");
    }
    const extraFd = await prisma.ledgerEntry.findUnique({
        where: { id: "d2733d17-ded6-4e1d-a07f-debdf92927de" },
        select: { id: true, voucherId: true }
    });
    if (extraFd) {
        const from = extraFd.voucherId;
        await prisma.ledgerEntry.delete({ where: { id: extraFd.id } });
        await deleteIfEmpty(from);
        stats.deletedVouchers.push("KFD-CONTRA-credit");
    }

    // BOM CA: restore full EMI credits and attach the split interest (and processing) lines.
    for (const g of BOM_GAPS) {
        const pay = await prisma.ledgerEntry.findUnique({
            where: { id: g.paymentEntry },
            select: { id: true, voucherId: true, amount: true }
        });
        if (!pay) continue;
        if (cents(pay.amount) !== cents(g.want)) {
            await prisma.ledgerEntry.update({ where: { id: pay.id }, data: { amount: g.want } });
            stats.bomUpdated += 1;
        }
        for (const moveId of g.move) {
            const row = await prisma.ledgerEntry.findUnique({
                where: { id: moveId },
                select: { id: true, voucherId: true }
            });
            if (!row) continue;
            if (row.voucherId !== pay.voucherId) {
                const from = row.voucherId;
                await prisma.ledgerEntry.update({ where: { id: row.id }, data: { voucherId: pay.voucherId } });
                stats.moved += 1;
                await deleteIfEmpty(from);
            }
        }
        await retotal(pay.voucherId);
    }

    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(report.tree || []);
    const pick = (re: RegExp) => all.filter(x => re.test(x.path)).map(x => ({
        path: x.path,
        od: x.node.openingDebit, oc: x.node.openingCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));
    const row = (path: string) => all.find(x => x.path === path)?.node;
    const want = [
        { path: "Current Assets > Bank Accounts > Deposits with Bank > KARNATAKA BANK FD AC NO - 5201500202002401", od: 575282, cd: 0, cc: 0 },
        { path: "Current Assets > Bank Accounts > Central Bank - 3224976293", od: 51715.17, cd: 0, cc: 0 },
        { path: "Current Assets > Bank Accounts > BOM CA 60435349267", od: 10666.95, cd: 8990.01, cc: 0 },
        { path: "Current Assets > Bank Accounts", od: 8272144.12, oc: 264020.59, cd: 11138855.51, cc: 0 }
    ];
    const mismatches = want.map(w => {
        const n = row(w.path);
        if (!n) return { path: w.path, issue: "missing" };
        const ok = cents(n.openingDebit) === cents(w.od)
            && cents(n.closingDebit) === cents(w.cd)
            && cents(n.closingCredit) === cents(w.cc ?? 0)
            && (w.oc == null || cents(n.openingCredit) === cents(w.oc));
        return ok ? null : { path: w.path, tb: { od: n.openingDebit, oc: n.openingCredit, cd: n.closingDebit, cc: n.closingCredit }, want: w };
    }).filter(Boolean);

    console.log(JSON.stringify({
        stats,
        mismatches,
        bank: pick(/Bank Accounts|Deposits with Bank|60435349267|3224976293|5201500202002401|BOM CA|Central Bank|KARNATAKA BANK FD AC NO - 5201500202002401$/),
        guards: pick(/Duties & Taxes$|Sundry Creditors$|Bank OD A\/c & CC A\/c$|Unsecured Loans$|Cash-in-Hand$|A G ASHTAVINAYAKA PETROCHEM PVT LTD-KARNATAKA$|Advance to S\. Creditors$|Sundry Debtors$|Prepaid Exp$/)
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
