import "dotenv/config";
import * as fs from "fs";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: number) => Number((v / 100).toFixed(2));
const norm = (v: unknown) => String(v || "")
    .replace(/\s*-\s*Sundry\s+(Debtor|Creditor)\s*$/i, "")
    .replace(/\s+/g, " ").trim().toUpperCase().replace(/[–—]/g, "-");

(async () => {
    const targets = JSON.parse(fs.readFileSync(".tmp-sd-targets.json", "utf8")).leaves as any[];
    const pdfBy = new Map<string, any>();
    for (const t of targets) {
        const k = norm(t.name);
        const prev = pdfBy.get(k);
        if (!prev) pdfBy.set(k, { ...t });
        else { prev.od += t.od; prev.oc += t.oc; prev.cd += t.cd; prev.cc += t.cc; }
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
    const parent = all.find(x => x.path === "Current Assets > Sundry Debtors");
    const children = all.filter(x => x.path.startsWith("Current Assets > Sundry Debtors > "));
    const tbBy = new Map<string, any>();
    for (const c of children) {
        const k = norm(c.node.name);
        const row = {
            name: c.node.name,
            od: Number(c.node.openingDebit || 0), oc: Number(c.node.openingCredit || 0),
            cd: Number(c.node.closingDebit || 0), cc: Number(c.node.closingCredit || 0)
        };
        const prev = tbBy.get(k);
        if (!prev) tbBy.set(k, row);
        else { prev.od += row.od; prev.oc += row.oc; prev.cd += row.cd; prev.cc += row.cc; }
    }
    const mismatches = [];
    for (const [k, tb] of tbBy) {
        const pdf = pdfBy.get(k);
        if (!pdf) { mismatches.push({ name: tb.name, issue: "extra", tb }); continue; }
        if (cents(tb.od) !== cents(pdf.od) || cents(tb.oc) !== cents(pdf.oc) || cents(tb.cd) !== cents(pdf.cd) || cents(tb.cc) !== cents(pdf.cc)) {
            mismatches.push({ name: tb.name, pdf, tb, closeGap: money(cents(tb.cd) - cents(tb.cc) - (cents(pdf.cd) - cents(pdf.cc))) });
        }
    }
    const missing = [...pdfBy.entries()].filter(([k, p]) => !tbBy.has(k) && (cents(p.cd) || cents(p.cc) || cents(p.od) || cents(p.oc))).map(([, p]) => p.name);
    const snap = (n: any) => n && { od: n.node.openingDebit, oc: n.node.openingCredit, cd: n.node.closingDebit, cc: n.node.closingCredit };
    console.log(JSON.stringify({
        parent: snap(parent),
        parentOk: parent && cents(parent.node.closingDebit) === cents(673716070.65) && cents(parent.node.closingCredit) === cents(16902464),
        childN: children.length,
        mismatchN: mismatches.length,
        mismatches,
        missing,
        extras: [...tbBy.entries()].filter(([k]) => !pdfBy.has(k)).map(([, v]) => v),
        guard: {
            SC: snap(all.find(x => x.path === "Current Liabilities > Sundry Creditors")),
            Duties: snap(all.find(x => x.path === "Current Liabilities > Duties & Taxes")),
            OD: snap(all.find(x => x.path === "Loans (Liability) > Bank OD A/c & CC A/c")),
            Unsec: snap(all.find(x => x.path === "Loans (Liability) > Unsecured Loans")),
            Cash: snap(all.find(x => x.path === "Current Assets > Cash-in-Hand")),
            Karnataka: snap(all.find(x => x.path.endsWith("A G ASHTAVINAYAKA PETROCHEM PVT LTD-KARNATAKA"))),
            AdvSC: snap(all.find(x => x.path.endsWith("Advance to S. Creditors")))
        }
    }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
