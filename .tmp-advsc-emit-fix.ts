import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const EMIT = "75446b1e-c87b-40b1-bf10-9a66c6c48204";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const orphan = await prisma.voucher.findFirst({
        where: { voucherNo: "ADVSC-EMIT-FY-RESTATE", voucherType: "JOURNAL" },
        select: {
            id: true,
            entries: { select: { id: true, amount: true, narration: true } },
            journals: { select: { id: true, status: true } }
        }
    });
    const head = await prisma.journalHead.findFirst({
        where: { ledgerId: EMIT },
        select: { id: true, name: true, type: true }
    });
    const sample = await prisma.journal.findFirst({
        where: {
            status: "APPROVED",
            journalHead: { ledgerId: EMIT },
            voucher: { voucherType: "JOURNAL", voucherDate: { gte: START, lte: END } }
        },
        select: {
            id: true, paymentMode: true, paymentThrough: true, direction: true,
            journalHeadId: true, voucherId: true, journalDate: true
        }
    });
    const host = await prisma.ledgerEntry.findFirst({
        where: {
            ledgerId: EMIT,
            voucher: {
                voucherType: "JOURNAL",
                voucherDate: { gte: START, lte: END },
                journals: { some: { status: "APPROVED" } }
            }
        },
        select: {
            voucherId: true,
            voucher: { select: { voucherNo: true, journals: { select: { id: true, status: true, categoryPath: true } } } }
        }
    });

    console.log(JSON.stringify({
        orphan: orphan ? { id: orphan.id, n: orphan.entries.length, journals: orphan.journals } : null,
        head, sample, host: host ? { voucherId: host.voucherId, no: host.voucher.voucherNo, journals: host.voucher.journals } : null
    }, null, 2));

    if (orphan && head) {
        const paymentMode = sample?.paymentMode || "OFFLINE";
        for (const entry of orphan.entries) {
            const exists = await prisma.journal.findFirst({
                where: { voucherId: orphan.id, amount: entry.amount, journalHeadId: head.id },
                select: { id: true }
            });
            if (exists) continue;
            await prisma.journal.create({
                data: {
                    id: randomUUID(),
                    branchId: BRANCH_ID,
                    journalHeadId: head.id,
                    amount: entry.amount,
                    direction: "OUTWARD",
                    paymentMode: paymentMode as any,
                    remarks: entry.narration,
                    journalDate: new Date("2025-04-01T06:00:00.000Z"),
                    status: "APPROVED",
                    voucherId: orphan.id,
                    voucherNo: "ADVSC-EMIT-FY-RESTATE"
                }
            });
        }
    } else if (orphan && !head && host) {
        // Move entries onto an already-approved journal voucher, then drop the orphan.
        for (const entry of orphan.entries) {
            const exists = await prisma.ledgerEntry.findFirst({
                where: { voucherId: host.voucherId, ledgerId: EMIT, entryType: "CREDIT", amount: entry.amount },
                select: { id: true }
            });
            if (!exists) {
                await prisma.ledgerEntry.update({
                    where: { id: entry.id },
                    data: { voucherId: host.voucherId }
                });
            } else {
                await prisma.ledgerEntry.delete({ where: { id: entry.id } });
            }
        }
        const v = await prisma.voucher.findUnique({
            where: { id: host.voucherId },
            select: { entries: { select: { entryType: true, amount: true } } }
        });
        const dr = v!.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const cr = v!.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        await prisma.voucher.update({
            where: { id: host.voucherId },
            data: { totalDebit: money(dr), totalCredit: money(cr) }
        });
        const leftover = await prisma.ledgerEntry.count({ where: { voucherId: orphan.id } });
        if (leftover === 0) {
            await prisma.voucher.delete({ where: { id: orphan.id } });
        }
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
    const emit = all.find(x => x.path.endsWith("EMIT INTERNATIONAL FZ LLC") && x.path.includes("Advance to S"));
    console.log(JSON.stringify({
        parent: parent && {
            od: parent.node.openingDebit, oc: parent.node.openingCredit,
            pd: parent.node.periodDebit, pc: parent.node.periodCredit,
            cd: parent.node.closingDebit, cc: parent.node.closingCredit
        },
        emit: emit && {
            od: emit.node.openingDebit, oc: emit.node.openingCredit,
            pd: emit.node.periodDebit, pc: emit.node.periodCredit,
            cd: emit.node.closingDebit, cc: emit.node.closingCredit
        }
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
