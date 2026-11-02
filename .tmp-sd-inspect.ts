import "dotenv/config";
import { prisma } from "./src/config/db";
import { ReportingService } from "./src/modules/reports/reporting.service";
import * as fs from "fs";

const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));

(async () => {
    const groups = await prisma.ledgerGroup.findMany({
        where: { name: { equals: "Sundry Debtors", mode: "insensitive" } },
        select: {
            id: true, name: true, code: true, parentId: true,
            parent: { select: { name: true, parent: { select: { name: true } } } },
            _count: { select: { ledgers: true } }
        }
    });

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
    const parent = all.find(x => x.path === "Current Assets > Sundry Debtors" || x.path === "Sundry Debtors");
    const underCA = all.filter(x => /Current Assets > Sundry Debtors/.test(x.path) || x.path === "Sundry Debtors");
    const children = all.filter(x => x.path.startsWith("Current Assets > Sundry Debtors > ") || x.path.startsWith("Sundry Debtors > "));
    const guard = all.filter(x =>
        /Duties & Taxes$|Sundry Creditors$|Bank OD A\/c & CC A\/c$|Unsecured Loans$|Cash-in-Hand$|A G ASHTAVINAYAKA PETROCHEM PVT LTD-KARNATAKA$|Advance to S\. Creditors$/.test(x.path)
    ).map(x => ({
        path: x.path, od: x.node.openingDebit, oc: x.node.openingCredit, cd: x.node.closingDebit, cc: x.node.closingCredit
    }));

    const targets = JSON.parse(fs.readFileSync(".tmp-sd-targets.json", "utf8"));
    const byName = new Map(targets.leaves.map((r: any) => [String(r.name).trim().toUpperCase(), r]));
    const mismatches: any[] = [];
    for (const c of children) {
        const t = byName.get(String(c.node.name).trim().toUpperCase());
        if (!t) {
            mismatches.push({
                name: c.node.name, issue: "extra",
                tb: { od: c.node.openingDebit, oc: c.node.openingCredit, cd: c.node.closingDebit, cc: c.node.closingCredit }
            });
            continue;
        }
        if (
            cents(c.node.openingDebit) !== cents(t.od) ||
            cents(c.node.openingCredit) !== cents(t.oc) ||
            cents(c.node.closingDebit) !== cents(t.cd) ||
            cents(c.node.closingCredit) !== cents(t.cc)
        ) {
            mismatches.push({
                name: c.node.name,
                pdf: t,
                tb: {
                    od: c.node.openingDebit, oc: c.node.openingCredit,
                    pd: c.node.periodDebit, pc: c.node.periodCredit,
                    cd: c.node.closingDebit, cc: c.node.closingCredit
                },
                closeGap: money(cents(c.node.closingDebit) - cents(c.node.closingCredit) - (cents(t.cd) - cents(t.cc)))
            });
        }
    }
    const tbNames = new Set(children.map(c => String(c.node.name).trim().toUpperCase()));
    const missing = targets.leaves.filter((r: any) =>
        (cents(r.cd) || cents(r.cc) || cents(r.od) || cents(r.oc)) &&
        !tbNames.has(String(r.name).trim().toUpperCase())
    );

    const out = {
        groups: groups.map(g => ({
            id: g.id, name: g.name, code: g.code, path: `${g.parent?.parent?.name || ""} > ${g.parent?.name || ""} > ${g.name}`,
            ledgers: g._count.ledgers
        })),
        parent: parent && {
            path: parent.path,
            od: parent.node.openingDebit, oc: parent.node.openingCredit,
            pd: parent.node.periodDebit, pc: parent.node.periodCredit,
            cd: parent.node.closingDebit, cc: parent.node.closingCredit
        },
        pdf: { od: 822816622.76, oc: 12551933.96, cd: 673716070.65, cc: 16902464 },
        childN: children.length,
        mismatchN: mismatches.length,
        extraN: mismatches.filter((m: any) => m.issue === "extra").length,
        missingN: missing.length,
        missing: missing.map((m: any) => m.name),
        mismatches: mismatches.slice(0, 80),
        guard
    };
    fs.writeFileSync(".tmp-sd-inspect.json", JSON.stringify({ ...out, allMismatches: mismatches, children: children.map(c => ({
        name: c.node.name, od: c.node.openingDebit, oc: c.node.openingCredit, cd: c.node.closingDebit, cc: c.node.closingCredit
    })) }, null, 2));
    console.log(JSON.stringify({
        groups: out.groups,
        parent: out.parent,
        pdf: out.pdf,
        parentGap: parent ? money(cents(parent.node.closingDebit) - cents(parent.node.closingCredit) - (cents(673716070.65) - cents(16902464))) : null,
        childN: out.childN,
        mismatchN: out.mismatchN,
        extraN: out.extraN,
        missingN: out.missingN,
        missing: out.missing,
        mismatchSample: mismatches.slice(0, 25).map((m: any) => ({
            name: m.name, issue: m.issue, closeGap: m.closeGap, tbCd: m.tb?.cd, tbCc: m.tb?.cc, pdfCd: m.pdf?.cd, pdfCc: m.pdf?.cc
        })),
        guard: out.guard
    }, null, 2));
    await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
