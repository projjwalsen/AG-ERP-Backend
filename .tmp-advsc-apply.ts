import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

const AVNTIKA = "8f5d8517-fa62-4f14-bdd1-f54bcfaf4184";
const RAAJ = "44220c32-ec22-4606-9152-d06ece6af0ab";
const IOCL = "586b1d06-0ecb-404a-9f4a-b47a23430ea1";
const EMIT = "75446b1e-c87b-40b1-bf10-9a66c6c48204";

const MOVES: Array<{ id: string; to: string }> = [
    // SIGMA unmatched Tally journals → active
    { id: "fc75e217-a949-42b9-9eb6-9dcad3c082ae", to: "dc88369d-7d35-46aa-a513-000417098ff3" },
    { id: "ea2e18bb-a857-4ee1-aeec-2fcf118c7e84", to: "dc88369d-7d35-46aa-a513-000417098ff3" },
    { id: "5e096f95-81d0-431e-b809-eb50c4af1ef2", to: "dc88369d-7d35-46aa-a513-000417098ff3" },
    { id: "77be9068-2616-4548-9321-4d735794606f", to: "dc88369d-7d35-46aa-a513-000417098ff3" },
    { id: "362a9ef4-f4ab-4ac6-8c56-0a18f2741222", to: "dc88369d-7d35-46aa-a513-000417098ff3" },
    { id: "5e0d905f-3f4a-49ee-889c-24e83c14ca00", to: "dc88369d-7d35-46aa-a513-000417098ff3" },
    { id: "5fa635ad-ef5c-4b56-ac4d-9700e36bfb71", to: "dc88369d-7d35-46aa-a513-000417098ff3" },
    { id: "96d6aeaf-8d89-4b89-a8ed-2ddb318c05f9", to: "dc88369d-7d35-46aa-a513-000417098ff3" },
    { id: "78602ce0-0624-4d0b-ac87-5ef72fb9afce", to: "dc88369d-7d35-46aa-a513-000417098ff3" },
    { id: "9e6964db-bfa4-454c-bbb2-ff48efcd27c4", to: "dc88369d-7d35-46aa-a513-000417098ff3" },
    // SILVER unmatched
    { id: "b602abfe-f4df-48f5-9496-2f286eea89ec", to: "0078c46b-b562-464f-a227-6ad70c1e7a6f" },
    { id: "f9069c43-bd20-4e59-b418-6fbd601468fb", to: "0078c46b-b562-464f-a227-6ad70c1e7a6f" },
    // GLOBAL 000068
    { id: "8e655ce9-2c11-42f4-a872-b91006c7913c", to: "8ce546c1-1871-4d6b-b637-4e7f32dece2d" },
    // CLASSIC CPPB/25-26/214
    { id: "7364a66e-3e77-4118-a9a3-f127c01f6547", to: "56374eba-3d95-4da9-a348-c95ae4b97880" },
    // DARSH
    { id: "63315802-3c4d-4b11-94a9-09609ba53c6b", to: "86d3c963-b177-4169-8228-07db9452a78c" },
    { id: "b7637f5e-4217-480a-b9c9-63c39aa37ce9", to: "86d3c963-b177-4169-8228-07db9452a78c" },
    { id: "c42ac453-4e80-4820-ae6a-d8b778c426ac", to: "86d3c963-b177-4169-8228-07db9452a78c" },
    { id: "16b8839c-04ea-4be8-af93-8e027aec11ec", to: "86d3c963-b177-4169-8228-07db9452a78c" },
    { id: "3cb08241-9319-405f-a2be-4536a3066f06", to: "86d3c963-b177-4169-8228-07db9452a78c" },
];

const EMIT_PRIOR = [
    "c462dcd0-c4c0-44da-b024-2d46a142a7c9",
    "cc4115c4-2c0a-4b91-a8e1-8692e699db7a",
    "d7ca3a50-190b-4cf6-b419-6a272e857946"
];
const EMIT_PERIOD_CREDITS = [
    { amount: 12582690.09, note: "EMIT FY credit restated from 2024-01-22 PUR-F0A8FA1E" },
    { amount: 7795966, note: "EMIT FY credit restated from 2024-01-31 PUR-12200E43" },
    { amount: 4498085.76, note: "EMIT FY credit restated from 2024-01-27 PUR-9A05E9E6" }
];

const PDF: Record<string, { cd: number; cc: number }> = {
    "ACCELERATOR GENERAL TRADING LLC": { cd: 21011561.77, cc: 0 },
    "AINUMPUDI SURESH VARMA": { cd: 50000, cc: 0 },
    "ALOIS BUILDERS AND INF": { cd: 1000000, cc: 0 },
    "AML MOTORS PVT LTD": { cd: 29344, cc: 0 },
    "Anjali Electricals": { cd: 44110, cc: 0 },
    "ASPHALTERA PRIVATE LIMITED": { cd: 237900, cc: 0 },
    "AVNTIKA ENTERPRISE CRS": { cd: 6329258, cc: 0 },
    "CLASSIC PETRO & ENERGY PRIVATE LIMITED CRS": { cd: 0, cc: 0 },
    "Darsh Enterprises (CR)": { cd: 0, cc: 0 },
    "DREAMZZ MAKERS EVENTS AN": { cd: 100000, cc: 0 },
    "EKVIRA TRANSPORT AND LOGISTICS": { cd: 236958, cc: 0 },
    "EMIT INTERNATIONAL FZ LLC": { cd: 13515828.93, cc: 0 },
    "GLOBAL PLASTO CHEM": { cd: 1199, cc: 0 },
    "HINDUSTAN PETROLEUM CORPORATION LIMITED": { cd: 45824.05, cc: 0 },
    "INDIAIDEAS.COM": { cd: 6478.36, cc: 0 },
    "Indian Oil Corporation Limited-GJ": { cd: 91313, cc: 0 },
    "INDIAN OIL CORPORATION LIMITED - MH": { cd: 6664, cc: 0 },
    "JALDEV SHIPPING AGENCY": { cd: 87886, cc: 0 },
    "KHANDOBA BIOREFINERIES PRIVATE LIMITED": { cd: 0, cc: 0 },
    "K M ENTERPRISE": { cd: 0, cc: 0 },
    "KS Oil Corporation - CR": { cd: 4080, cc: 0 },
    "M1 EXCHANGE": { cd: 0, cc: 0 },
    "MAYRA PETROLEUM FZCO": { cd: 11475470.6, cc: 0 },
    "MSTC LTD": { cd: 274028, cc: 0 },
    "Mynd Solutions Pvt. Ltd.": { cd: 2156, cc: 0 },
    "NAYARA ENERGY LIMITED": { cd: 0, cc: 0 },
    "NAZPAL OIL ENERGY L.L.C": { cd: 5850826.45, cc: 0 },
    "NEPTUNE PETROCHEMICALS LIMITED - UP CRS": { cd: 0, cc: 0 },
    "RAAJ UNOCAL LUBRICANTS LTD": { cd: 7071843.37, cc: 0 },
    "ROYAL AUTOCRYSTAL SERVICES PRIVATE LIMITED": { cd: 3594, cc: 0 },
    "ROYAL ENTERPRISES": { cd: 416, cc: 0 },
    "SANDEEPDADA THAKUR FOUNDATION": { cd: 100000, cc: 0 },
    "SHANTI HEAVY DUTY EARTH MOVERS": { cd: 49500, cc: 0 },
    "SHREE HARI ENTERPRISES": { cd: 26334, cc: 0 },
    "SIDDHARTH TRADERS": { cd: 2100000, cc: 0 },
    "SIGMA PETROCHEM": { cd: 1490, cc: 0 },
    "SILVERBACK INFRA PRIVATE LIMITED": { cd: 0, cc: 0 },
    "STAR MOTORS": { cd: 0, cc: 0 },
    "SUKHMANI OIL AND LUBE CRS": { cd: 5783, cc: 0 },
};

async function refreshTotals(voucherIds: string[]) {
    for (const id of [...new Set(voucherIds)]) {
        const v = await prisma.voucher.findUnique({
            where: { id },
            select: { entries: { select: { entryType: true, amount: true } } }
        });
        if (!v) continue;
        const dr = v.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const cr = v.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        await prisma.voucher.update({
            where: { id },
            data: { totalDebit: money(dr), totalCredit: money(cr) }
        });
    }
}

(async () => {
    const stats = { deletedPurchases: 0, moved: 0, emitUnlinked: 0, emitPosted: 0 };

    const purchaseCredits = await prisma.ledgerEntry.findMany({
        where: {
            ledgerId: { in: [AVNTIKA, RAAJ, IOCL] },
            entryType: "CREDIT",
            voucher: {
                voucherType: "PURCHASE",
                voucherDate: { gte: START, lte: END }
            }
        },
        select: { id: true, voucherId: true, ledgerId: true, amount: true }
    });
    if (purchaseCredits.length) {
        await prisma.ledgerEntry.deleteMany({ where: { id: { in: purchaseCredits.map(e => e.id) } } });
        stats.deletedPurchases = purchaseCredits.length;
        await refreshTotals(purchaseCredits.map(e => e.voucherId));
    }

    const moveRows = await prisma.ledgerEntry.findMany({
        where: { id: { in: MOVES.map(m => m.id) } },
        select: { id: true, ledgerId: true, voucherId: true }
    });
    const moveById = new Map(MOVES.map(m => [m.id, m.to]));
    const toMove = moveRows.filter(e => e.ledgerId !== moveById.get(e.id));
    if (toMove.length) {
        const values = toMove.map(e => `('${e.id}','${moveById.get(e.id)}')`).join(",");
        await prisma.$executeRawUnsafe(
            `UPDATE "LedgerEntry" e SET "ledgerId" = x.target FROM (VALUES ${values}) AS x(id, target) WHERE e.id = x.id`
        );
        stats.moved = toMove.length;
    }

    const emitPrior = await prisma.ledgerEntry.findMany({
        where: { id: { in: EMIT_PRIOR }, ledgerId: EMIT },
        select: { id: true, voucherId: true, amount: true }
    });
    if (emitPrior.length) {
        await prisma.ledgerEntry.deleteMany({ where: { id: { in: emitPrior.map(e => e.id) } } });
        stats.emitUnlinked = emitPrior.length;
        await refreshTotals(emitPrior.map(e => e.voucherId));
    }

    const alreadyEmit = await prisma.ledgerEntry.findFirst({
        where: {
            ledgerId: EMIT,
            entryType: "CREDIT",
            amount: 12582690.09,
            voucher: { voucherNo: "ADVSC-EMIT-FY-RESTATE", voucherType: "JOURNAL" }
        },
        select: { id: true }
    });
    if (!alreadyEmit) {
        const voucherId = randomUUID();
        await prisma.voucher.create({
            data: {
                id: voucherId,
                voucherNo: "ADVSC-EMIT-FY-RESTATE",
                voucherType: "JOURNAL",
                sourceId: randomUUID(),
                branchId: BRANCH_ID,
                narration: "Advance to S. Creditors: EMIT credits restated into FY 2025-26",
                voucherDate: new Date("2025-04-01T06:00:00.000Z"),
                totalDebit: 0,
                totalCredit: 24876741.85,
                entries: {
                    create: EMIT_PERIOD_CREDITS.map(row => ({
                        ledgerId: EMIT,
                        branchId: BRANCH_ID,
                        entryType: "CREDIT" as const,
                        amount: row.amount,
                        narration: row.note
                    }))
                }
            }
        });
        stats.emitPosted = EMIT_PERIOD_CREDITS.length;
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
    const all = walk(report.tree || []);
    const parent = all.find(x => x.path === "Current Assets > Loans & Advances (Asset) > Advance to S. Creditors");
    const children = all.filter(x => x.path.startsWith("Current Assets > Loans & Advances (Asset) > Advance to S. Creditors > "));
    const mismatches = children.map(c => {
        const pdf = PDF[c.node.name];
        if (!pdf) return { name: c.node.name, issue: "extra" };
        const ok = cents(c.node.closingDebit) === cents(pdf.cd) && cents(c.node.closingCredit) === cents(pdf.cc);
        return ok ? null : {
            name: c.node.name,
            tb: { od: c.node.openingDebit, oc: c.node.openingCredit, cd: c.node.closingDebit, cc: c.node.closingCredit },
            pdf
        };
    }).filter(Boolean);
    const guard = all.filter(x =>
        /Duties & Taxes$|Sundry Creditors$|Bank OD A\/c & CC A\/c$|Unsecured Loans$|Cash-in-Hand$|A G ASHTAVINAYAKA PETROCHEM PVT LTD-KARNATAKA$|Branch \/ Divisions$/.test(x.path)
    ).map(x => ({
        path: x.path,
        od: x.node.openingDebit, oc: x.node.openingCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));

    console.log(JSON.stringify({
        stats,
        parent: parent ? {
            od: parent.node.openingDebit, oc: parent.node.openingCredit,
            pd: parent.node.periodDebit, pc: parent.node.periodCredit,
            cd: parent.node.closingDebit, cc: parent.node.closingCredit
        } : null,
        target: { od: 88664511.64, oc: 87008031.39, pd: 478604378.12, pc: 410501011.84, cd: 69759846.53, cc: 0 },
        mismatchCount: mismatches.length,
        mismatches,
        guard
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
