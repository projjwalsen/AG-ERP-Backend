import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";
import { VoucherType } from "@prisma/client";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const STOCK_LEDGER = "e07febdc-754a-4f04-aaf4-8d6e03f00dd9";
const AMOUNT = 368726872.59;

const localDate = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(d);

const walk = (nodes: any[], path: string[] = []): any[] =>
    nodes.flatMap(node => {
        const next = [...path, node.name];
        return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
    });

const snap = async () => {
    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const all = walk(report.tree || []);
    const ca = all.find(x => x.path === "Current Assets")?.node;
    const children = (ca?.children || []).map((c: any) => ({
        name: c.name,
        od: c.openingDebit,
        oc: c.openingCredit,
        cd: c.closingDebit,
        cc: c.closingCredit
    }));
    return {
        ca: ca && { od: ca.openingDebit, oc: ca.openingCredit, cd: ca.closingDebit, cc: ca.closingCredit },
        children,
        stock: children.find((c: any) => c.name === "Opening Stock")
    };
};

(async () => {
    const before = await snap();

    const voucher = await prisma.voucher.findFirst({
        where: { voucherNo: "OPENING-STOCK", branchId: BRANCH },
        include: {
            entries: { include: { ledger: { select: { id: true, name: true } } } },
            journals: { select: { id: true, status: true, amount: true } }
        }
    });
    if (!voucher) throw new Error("OPENING-STOCK voucher not found");
    if (voucher.entries.length !== 1) {
        throw new Error(`Expected a single Opening Stock entry, found ${voucher.entries.length}`);
    }
    const entry = voucher.entries[0];
    if (entry.ledgerId !== STOCK_LEDGER) {
        throw new Error(`Entry is on ${entry.ledger.name}, not Opening Stock`);
    }
    if (entry.entryType !== "DEBIT") throw new Error(`Expected DEBIT, got ${entry.entryType}`);
    if (Number(entry.amount) !== AMOUNT) {
        throw new Error(`Expected ${AMOUNT}, got ${entry.amount}`);
    }
    if (voucher.voucherType !== VoucherType.JOURNAL) {
        throw new Error(`Expected JOURNAL, got ${voucher.voucherType}`);
    }

    await prisma.voucher.update({
        where: { id: voucher.id },
        data: { voucherType: VoucherType.OPENING_BALANCE }
    });

    const after = await snap();
    const unchanged = before.children
        .filter((c: any) => c.name !== "Opening Stock")
        .map((c: any) => {
            const n = after.children.find((x: any) => x.name === c.name);
            const same = n && n.od === c.od && n.oc === c.oc && n.cd === c.cd && n.cc === c.cc;
            return { name: c.name, same, before: c, after: n };
        });
    const changedOthers = unchanged.filter((x: any) => !x.same);

    console.log(JSON.stringify({
        voucher: {
            id: voucher.id,
            no: voucher.voucherNo,
            date: localDate(voucher.voucherDate),
            from: "JOURNAL",
            to: "OPENING_BALANCE",
            amount: AMOUNT,
            journals: voucher.journals
        },
        before,
        after,
        target: {
            stock: { od: AMOUNT, oc: 0, cd: AMOUNT, cc: 0 },
            ca: { od: 1308671312.36, oc: 99823985.94, cd: 1155862962.64, cc: 16902464 }
        },
        caGap: after.ca && {
            od: Number((after.ca.od - 1308671312.36).toFixed(2)),
            oc: Number((after.ca.oc - 99823985.94).toFixed(2)),
            cd: Number((after.ca.cd - 1155862962.64).toFixed(2)),
            cc: Number((after.ca.cc - 16902464).toFixed(2))
        },
        otherHeadsChanged: changedOthers
    }, null, 2));

    await prisma.$disconnect();
})().catch(async e => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
