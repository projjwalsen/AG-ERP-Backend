import "dotenv/config";
import { ReportingService } from "./src/modules/reports/reporting.service";

(async () => {
    const report = await ReportingService.getTrialBalanceReport(
        { id: "c7feaec8-d19f-480b-8bf3-036745415849", branchAccessType: "ALL" },
        { branchId: "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb", startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const cl = (report.tree || []).find((n: any) => n.name === "Current Liabilities");
    const sc = (cl?.children || []).find((n: any) => n.name === "Sundry Creditors");
    const kids = (sc?.children || []).map((n: any) => ({
        name: n.name,
        rowType: n.rowType,
        openDr: n.openingDebit,
        openCr: n.openingCredit,
        perDr: n.periodDebit,
        perCr: n.periodCredit,
        closeDr: n.closingDebit,
        closeCr: n.closingCredit,
        childCount: (n.children || []).length
    }));
    const zeroGroups = kids.filter(k => k.rowType === "accountingHeader" && !k.openDr && !k.openCr && !k.perDr && !k.perCr);
    const named = ["Falguni Jain", "A G ART PETROCHEM LLP - CR", "ANGEL TRADING FZE", "AGARWAL INDUSTRIAL CORPORATION LIMITED-CR", "Sulaki Chemicals Pvt Ltd-CR", "GAURAV CHEMICALS - CR"];
    console.log(JSON.stringify({
        sc: {
            openDr: sc.openingDebit, openCr: sc.openingCredit,
            perDr: sc.periodDebit, perCr: sc.periodCredit,
            closeDr: sc.closingDebit, closeCr: sc.closingCredit
        },
        zeroNamedGroups: zeroGroups,
        selected: kids.filter(k => named.some(n => k.name.toLowerCase() === n.toLowerCase())),
        headerCount: kids.filter(k => k.rowType === "accountingHeader").length,
        ledgerCount: kids.filter(k => k.rowType !== "accountingHeader").length
    }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
