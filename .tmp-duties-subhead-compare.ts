import "dotenv/config";
import * as fs from "fs";
import { ReportingService } from "./src/modules/reports/reporting.service";

const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const TARGET = { openDr: 4493898.64, openCr: 10561093.14, closeDr: 229972.85, closeCr: 5628516.95 };
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const money = (v: unknown) => Number((Number(v || 0)).toFixed(2));
const norm = (v: unknown) => String(v || "").replace(/_x000D_/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

(async () => {
    const excel: { name: string; od: number; oc: number; cd: number; cc: number }[] =
        JSON.parse(fs.readFileSync(".tmp-duties-closing-excel.json", "utf8"));

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
    const head = all.find(x => x.path === "Current Liabilities > Duties & Taxes");
    const under = all.filter(x => x.path.startsWith("Current Liabilities > Duties & Taxes"));
    const byName = new Map<string, any[]>();
    for (const x of under) {
        const k = norm(x.node.name);
        byName.set(k, [...(byName.get(k) || []), x]);
    }

    const mismatches = [];
    for (const xl of excel) {
        const hits = byName.get(norm(xl.name)) || [];
        const node = hits[0]?.node;
        if (!node) {
            if (xl.od || xl.oc || xl.cd || xl.cc) mismatches.push({ name: xl.name, reason: "missing-in-tb", excel: xl });
            continue;
        }
        const tb = {
            od: money(node.openingDebit), oc: money(node.openingCredit),
            cd: money(node.closingDebit), cc: money(node.closingCredit)
        };
        if (cents(tb.od) !== cents(xl.od) || cents(tb.oc) !== cents(xl.oc) ||
            cents(tb.cd) !== cents(xl.cd) || cents(tb.cc) !== cents(xl.cc)) {
            mismatches.push({
                name: xl.name, path: hits[0].path,
                excel: xl, tb,
                dOd: money(tb.od - xl.od), dOc: money(tb.oc - xl.oc),
                dCd: money(tb.cd - xl.cd), dCc: money(tb.cc - xl.cc)
            });
        }
    }
    const extraTb = under.filter(x =>
        x.path !== "Current Liabilities > Duties & Taxes" &&
        !excel.some(xl => norm(xl.name) === norm(x.node.name)) &&
        (Number(x.node.closingDebit) || Number(x.node.closingCredit) || Number(x.node.openingDebit) || Number(x.node.openingCredit))
    ).map(x => ({
        path: x.path, od: money(x.node.openingDebit), oc: money(x.node.openingCredit),
        cd: money(x.node.closingDebit), cc: money(x.node.closingCredit)
    }));

    const h = head?.node;
    console.log(JSON.stringify({
        excelRows: excel.length,
        head: h ? {
            od: money(h.openingDebit), oc: money(h.openingCredit),
            pd: money(h.periodDebit), pc: money(h.periodCredit),
            cd: money(h.closingDebit), cc: money(h.closingCredit)
        } : null,
        parentMatch: h ? {
            openDr: cents(h.openingDebit) === cents(TARGET.openDr),
            openCr: cents(h.openingCredit) === cents(TARGET.openCr),
            closeDr: cents(h.closingDebit) === cents(TARGET.closeDr),
            closeCr: cents(h.closingCredit) === cents(TARGET.closeCr)
        } : null,
        mismatchCount: mismatches.length,
        mismatches,
        extraTb
    }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
