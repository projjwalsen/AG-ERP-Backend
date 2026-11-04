import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";

const URD_CANON = "e6ffe590-2757-4b30-94f1-278a55024501";
const URD_DUP = "2a2c72c3-c2c8-4b9c-959d-697f8b1944c3";
const RD_CANON = "1212a65a-f7d5-4ce8-a578-2552e8fa5d0f";
const RD_DUP = "32920321-6a95-47c7-9fda-8cef5af34dcd";

const walk = (nodes: any[], path: string[] = []): any[] =>
    nodes.flatMap(node => {
        const next = [...path, node.name];
        return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
    });

const amounts = (n: any) => n && ({
    od: n.openingDebit, oc: n.openingCredit,
    pd: n.periodDebit, pc: n.periodCredit,
    cd: n.closingDebit, cc: n.closingCredit
});

const snap = async () => {
    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const all = walk(report.tree || []);
    const de = all.find(x => x.path === "Direct Expenses")?.node;
    return {
        de: amounts(de),
        children: (de?.children || []).map((c: any) => ({ name: c.name, ...amounts(c) })),
        carriage: all.filter(x => /Carriage Inward/i.test(x.path)).map(x => ({
            path: x.path, ...amounts(x.node), childCount: (x.node.children || []).length
        }))
    };
};

const mergeLedger = async (dupId: string, canonId: string, expectedName: string) => {
    const dup = await prisma.ledger.findUnique({
        where: { id: dupId },
        select: { id: true, name: true, isActive: true }
    });
    const canon = await prisma.ledger.findUnique({
        where: { id: canonId },
        select: { id: true, name: true, isActive: true }
    });
    if (!dup || !canon) throw new Error(`Missing ledger ${dupId} or ${canonId}`);
    if (dup.name.toUpperCase() !== expectedName.toUpperCase()) {
        throw new Error(`Dup name ${dup.name} != ${expectedName}`);
    }
    if (canon.name.toUpperCase() !== expectedName.toUpperCase()) {
        throw new Error(`Canon name ${canon.name} != ${expectedName}`);
    }

    const others = await prisma.ledger.count({
        where: { groupId: (await prisma.ledger.findUnique({ where: { id: dupId }, select: { groupId: true } }))!.groupId, id: { not: dupId }, isActive: true }
    });
    if (others !== 0) throw new Error(`Nested group for ${expectedName} has other active ledgers`);

    const movedEntries = await prisma.ledgerEntry.updateMany({
        where: { ledgerId: dupId },
        data: { ledgerId: canonId }
    });
    const movedHeads = await prisma.journalHead.updateMany({
        where: { ledgerId: dupId },
        data: { ledgerId: canonId }
    });
    await prisma.ledger.update({
        where: { id: dupId },
        data: { isActive: false }
    });
    return { movedEntries: movedEntries.count, movedHeads: movedHeads.count, dup: dup.name, canon: canon.name };
};

(async () => {
    const before = await snap();

    const urd = await mergeLedger(URD_DUP, URD_CANON, "Carriage Inward URD");
    const rd = await mergeLedger(RD_DUP, RD_CANON, "Carriage Inwards RD");

    const after = await snap();
    const otherChanged = before.children
        .filter((c: any) => !/Carriage Inward/i.test(c.name))
        .filter((c: any) => {
            const n = after.children.find((x: any) => x.name === c.name);
            return !n || n.od !== c.od || n.oc !== c.oc || n.pd !== c.pd || n.pc !== c.pc || n.cd !== c.cd || n.cc !== c.cc;
        });

    console.log(JSON.stringify({
        urd, rd,
        before: { de: before.de, carriage: before.carriage, children: before.children },
        after: { de: after.de, carriage: after.carriage, children: after.children },
        target: {
            urd: { pd: 22228865.5, pc: 121824, cd: 22107041.5, cc: 0 },
            rd: { pd: 23728996, pc: 273849, cd: 23455147, cc: 0 }
        },
        otherDirectExpenseHeadsChanged: otherChanged
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
