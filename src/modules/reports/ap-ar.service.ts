import sundryDebtorReport from "./APAR/drs31.03.2026.json";
import sundryCreditorReport from "./APAR/crs31.03.2026.json";
import payableBills from "./APAR/AP.json";
import receivableBills from "./APAR/AR.json";
import { prisma } from "../../config/db";

export type ReportType = "PAYABLE" | "RECEIVABLE";
export type APARSourceRow = Record<string, string | number | null | undefined>;

const amount = (value: unknown) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};

const nullableAmount = (value: unknown) => {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
};

const buildAgingRows = (sourceRows: APARSourceRow[], company: string, balanceType: string, gstinByAgency: Map<string, string>) => {
    const grouped = new Map<string, { agencyName: string; outstandingAmount: number; agingDays: number; billCount: number }>();
    for (const row of sourceRows.slice(9)) {
        const agencyName = String(row["__EMPTY_1"] || "").replace(/[\r\n]+/g, " ").trim();
        const outstandingAmount = nullableAmount(row["__EMPTY_2"]);
        if (!agencyName || outstandingAmount === null) continue;

        const key = agencyName.toLocaleUpperCase();
        const current = grouped.get(key) || { agencyName, outstandingAmount: 0, agingDays: 0, billCount: 0 };
        current.outstandingAmount = Number((current.outstandingAmount + outstandingAmount).toFixed(2));
        current.agingDays = Math.max(current.agingDays, amount(row["__EMPTY_4"]));
        current.billCount += 1;
        grouped.set(key, current);
    }

    return [...grouped.values()]
        .sort((a, b) => a.agencyName.localeCompare(b.agencyName, "en", { sensitivity: "base" }))
        .map((row, index) => ({
            partyCode: `V${String(index + 1).padStart(3, "0")}`,
            agencyName: row.agencyName,
            branch: company,
            gstin: gstinByAgency.get(row.agencyName.toLocaleUpperCase()) || "",
            outstandingAmount: row.outstandingAmount,
            balanceType,
            agingDays: row.agingDays,
            billCount: row.billCount
        }));
};

const parsePeriod = (value: string) => {
    const parseDate = (part: string) => {
        const match = part.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
        if (!match) return null;
        const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
            .indexOf(match[2].toUpperCase());
        if (month < 0) return null;
        let year = Number(match[3]);
        if (year < 100) year += year >= 70 ? 1900 : 2000;
        return new Date(Date.UTC(year, month, Number(match[1])));
    };
    const [start, end] = value.split(/\s+to\s+/i);
    return { startDate: start ? parseDate(start) : null, endDate: end ? parseDate(end) : null };
};

export class Srv1APARService {
    static async getSrv1APARReport(type: ReportType) {
        const reportKey = type === "PAYABLE" ? "Sundry Creditors" : "Sundry Debtors";
        const report = (type === "PAYABLE" ? sundryCreditorReport : sundryDebtorReport) as unknown as Record<string, APARSourceRow[]>;
        const source = report[reportKey] || [];
        const companyName = Object.keys(source[0] || {})[0] || "Company";
        const reportTitle = String(source[4]?.[companyName] || (type === "PAYABLE" ? "Sundry Creditors" : "Sundry Debtors"));
        const periodLabel = String(source[6]?.[companyName] || "");
        const grandTotalIndex = source.findIndex(row => String(row[companyName] || "").trim().toUpperCase() === "GRAND TOTAL");
        const grandTotalSource = grandTotalIndex >= 0 ? source[grandTotalIndex] : null;
        const dataEnd = grandTotalIndex >= 0 ? grandTotalIndex : source.length;
        const rows = source.slice(12, dataEnd).map(row => ({
            account: String(row[companyName] || "").trim(),
            openingBalance: nullableAmount(row["Unnamed: 1"]),
            transactionDebit: nullableAmount(row["Unnamed: 2"]),
            transactionCredit: nullableAmount(row["Unnamed: 3"]),
            closingBalance: nullableAmount(row["Unnamed: 4"])
        })).filter(row => row.account);

        const transactionDebitFromRows = Number(rows.reduce((sum, row) => sum + amount(row.transactionDebit), 0).toFixed(2));
        const transactionCreditFromRows = Number(rows.reduce((sum, row) => sum + amount(row.transactionCredit), 0).toFixed(2));
        const summary = {
            totalLedgers: rows.length,
            openingBalance: amount(grandTotalSource?.["Unnamed: 1"]),
            transactionDebit: amount(grandTotalSource?.["Unnamed: 2"]),
            transactionCredit: amount(grandTotalSource?.["Unnamed: 3"]),
            closingBalance: amount(grandTotalSource?.["Unnamed: 4"])
        };
        const agingSourceRows = (type === "PAYABLE" ? payableBills : receivableBills) as unknown as APARSourceRow[];
        const agencies = await prisma.agency.findMany({
            where: { isActive: true },
            select: { name: true, gstin: true }
        });
        const gstinByAgency = new Map<string, string>();
        for (const agency of agencies) {
            if (!agency.gstin) continue;
            gstinByAgency.set(
                agency.name.replace(/[\r\n]+/g, " ").trim().toLocaleUpperCase(),
                agency.gstin
            );
        }
        const agingRows = buildAgingRows(agingSourceRows, companyName, type, gstinByAgency);
        const agingOutstandingTotal = Number(agingRows.reduce((sum, row) => sum + row.outstandingAmount, 0).toFixed(2));
        const period = parsePeriod(periodLabel);

        return {
            reportName: type === "PAYABLE"
                ? "Accounts Payable - Sundry Creditors"
                : "Accounts Receivable - Sundry Debtors",
            generatedAt: new Date(),
            type,
            company: companyName,
            companyDetails: {
                addressLines: [source[0]?.[companyName], source[1]?.[companyName]],
                identifier: source[2]?.[companyName],
                email: source[3]?.[companyName]
            },
            group: reportTitle,
            branchHeading: source[8]?.["Unnamed: 1"] || `${companyName} (from ${periodLabel.split(/\s+to\s+/i)[0] || ""})`,
            period: { ...period, label: periodLabel || null },
            layout: {
                columns: [
                    { key: "account", label: "Particulars" },
                    { key: "openingBalance", label: "Opening Balance" },
                    { key: "transactionDebit", label: "Transaction Debit", section: "Transactions" },
                    { key: "transactionCredit", label: "Transaction Credit", section: "Transactions" },
                    { key: "closingBalance", label: "Closing Balance" }
                ]
            },
            summary,
            rows,
            agingRows,
            diagnostics: {
                sourceLedgers: rows.length,
                agingParties: agingRows.length,
                pendingBillRows: agingRows.reduce((sum, row) => sum + row.billCount, 0),
                agingOutstandingTotal,
                grandTotalAvailable: grandTotalSource !== null,
                transactionDebitRowsTotal: transactionDebitFromRows,
                transactionCreditRowsTotal: transactionCreditFromRows,
                transactionTotalsMatchSource: Math.abs(transactionDebitFromRows - summary.transactionDebit) < 0.01 &&
                    Math.abs(transactionCreditFromRows - summary.transactionCredit) < 0.01,
                invoiceAgingAvailable: true
            }
        };
    }
}
