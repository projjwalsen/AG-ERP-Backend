import "dotenv/config";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const START = new Date("2025-03-31T18:30:00.000Z");
const END = new Date("2026-03-31T18:29:59.999Z");
const BOM_IDS = ["c1f62a06-f402-4b4c-a2b3-1dc3cb31c0b5", "8faa06f2-6b04-404e-8729-1cc3dd5d073b"];
const HEADING_UNSEC = "bd2899d0-0a09-4ca1-89fe-4d5601c9dccf";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const compare = JSON.parse(fs.readFileSync(".tmp-unsec-compare.json", "utf8"));
    const extract = JSON.parse(fs.readFileSync(".tmp-unsec-excel.json", "utf8"));
    let deleted = 0;
    let added = 0;

    // Strip leftover period+opening extras from same-name copies under Unsecured Loans
    for (const row of compare) {
        const copyIds = (row.copies as any[])
            .filter(c => c.id !== row.canonId && c.cat === "JOURNAL" && /Unsecured|Loan From Director/i.test(c.path))
            .map(c => c.id);
        if (!copyIds.length) continue;
        const extras = await prisma.ledgerEntry.findMany({
            where: { ledgerId: { in: copyIds } },
            select: { id: true }
        });
        if (extras.length) {
            await prisma.ledgerEntry.deleteMany({ where: { id: { in: extras.map(e => e.id) } } });
            deleted += extras.length;
        }
    }

    // Remaining heading EMI 2884 → Written Off if present, else leave but it's tiny
    const headingLeft = await prisma.ledgerEntry.findMany({
        where: { ledgerId: HEADING_UNSEC },
        select: { id: true, amount: true, voucherId: true }
    });
    const writtenOff = await prisma.ledger.findFirst({
        where: { name: { equals: "Written Off", mode: "insensitive" }, group: { name: { contains: "Indirect", mode: "insensitive" } } },
        select: { id: true }
    });
    for (const e of headingLeft) {
        if (writtenOff) {
            await prisma.ledgerEntry.update({ where: { id: e.id }, data: { ledgerId: writtenOff.id } });
        }
    }

    // Fill three remaining missing rows
    const missingJobs = [
        { ledger: "Auriolus Finvest Pvt Ltd (BIZFUNDS)", no: "PDN/M/2526/002", side: "DEBIT" as const, amount: 2579 },
        { ledger: "L &T FINANCE LIMITED BL250613256600976", no: null, side: "DEBIT" as const, amount: 172552.24 },
        { ledger: "AXIS BANK LOAN - BPR064708241270", no: "10646", side: "DEBIT" as const, amount: 232227 }
    ];
    const xlByName = new Map(extract.ledgers.map((l: any) => [l.ledger, l]));
    for (const job of missingJobs) {
        const row = compare.find((r: any) => r.ledger === job.ledger);
        const xl = xlByName.get(job.ledger);
        const miss = (xl?.vouchers || []).find((v: any) =>
            cents(v.amount) === cents(job.amount) && v.side === job.side && (!job.no || String(v.no) === String(job.no))
        );
        if (!row || !miss) continue;
        const vs = await prisma.voucher.findMany({
            where: {
                branchId: BRANCH_ID,
                ...(job.no ? { voucherNo: String(job.no) } : {}),
            },
            select: {
                id: true, voucherNo: true, voucherType: true,
                entries: { select: { entryType: true, amount: true, ledgerId: true, ledger: { select: { name: true } } } }
            }
        });
        const dated = job.no ? vs : vs.filter(v => v.entries.some(e => cents(e.amount) === cents(job.amount)));
        let host = dated.find(v => {
            const dr = v.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
            const cr = v.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
            return job.side === "DEBIT" ? (cr - dr === cents(job.amount) || (dr === 0 && cr === cents(job.amount))) : (dr - cr === cents(job.amount));
        }) || dated.find(v => v.entries.some(e => BOM_IDS.includes(e.ledgerId) && cents(e.amount) === cents(job.amount)));
        if (!host && dated[0]) host = dated[0];
        if (!host) {
            console.log("NO HOST", job);
            continue;
        }
        const already = host.entries.some(e => e.ledgerId === row.canonId && e.entryType === job.side && cents(e.amount) === cents(job.amount));
        if (already) continue;
        const dr = host.entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + cents(e.amount), 0);
        const cr = host.entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + cents(e.amount), 0);
        await prisma.ledgerEntry.create({
            data: {
                id: randomUUID(),
                voucherId: host.id,
                ledgerId: row.canonId,
                branchId: BRANCH_ID,
                entryType: job.side,
                amount: job.amount,
                narration: `Unsec recon ${miss.no} ${job.ledger}`.slice(0, 200)
            }
        });
        await prisma.voucher.update({
            where: { id: host.id },
            data: {
                totalDebit: money(dr + (job.side === "DEBIT" ? cents(job.amount) : 0)),
                totalCredit: money(cr + (job.side === "CREDIT" ? cents(job.amount) : 0))
            }
        });
        added += 1;
        console.log("ADDED", job, "on", host.voucherNo, host.voucherType);
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
    const unsec = all.filter(x => /Loans \(Liability\) > Unsecured/.test(x.path)).map(x => ({
        path: x.path,
        od: x.node.openingDebit, oc: x.node.openingCredit,
        pd: x.node.periodDebit, pc: x.node.periodCredit,
        cd: x.node.closingDebit, cc: x.node.closingCredit
    }));
    const guard = all.filter(x =>
        /Duties & Taxes$|Sundry Creditors$|Bank OD A\/c/.test(x.path)
    ).map(x => ({
        path: x.path, cd: x.node.closingDebit, cc: x.node.closingCredit,
        oc: x.node.openingCredit, od: x.node.openingDebit
    }));

    console.log(JSON.stringify({
        deleted, added,
        parent: unsec.find(x => x.path === "Loans (Liability) > Unsecured Loans"),
        directors: unsec.find(x => x.path.endsWith("Loan From Directors") && x.path.split(" > ").length === 3),
        bank: unsec.find(x => x.path.endsWith("Unsecured from Bank") && x.path.split(" > ").length === 3),
        other: unsec.find(x => x.path.endsWith("Unsecured from Other than Bank") && x.path.split(" > ").length === 3),
        pdf: { parentCc: 209169654.45, dirCc: 21758069.62, bankCc: 86783560.99, otherCc: 100628023.84, parentOc: 194220007.32 },
        leaves: unsec.filter(x => x.path.split(" > ").length >= 3),
        guard
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
