import payableRows from "./APAR/AP.json";
import receivableRows from "./APAR/AR.json";

type ReportType = "PAYABLE" | "RECEIVABLE";
type SourceRow = Record<string, string | number | null | undefined>;

const amount = (value: unknown) => {
    const result = Number(value ?? 0);
    return Number.isFinite(result) ? Number(result.toFixed(2)) : 0;
};

const excelDate = (value: unknown): Date | null => {
    const serial = Number(value);
    if (!Number.isFinite(serial) || serial <= 0) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
};

const parsePeriod = (value: string) => {
    const parsePart = (part: string) => {
        const match = (part || "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
        if (!match) return null;
        const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
            .indexOf(match[2].toUpperCase());
        if (month < 0) return null;
        let year = Number(match[3]);
        if (year < 100) year += year >= 70 ? 1900 : 2000;
        return new Date(Date.UTC(year, month, Number(match[1])));
    };
    const [start, end] = value.split(/\s+to\s+/i);
    return { startDate: parsePart(start), endDate: parsePart(end) };
};

const bucketFor = (days: number) => {
    if (days <= 60) return "bucket_0_60_days" as const;
    if (days <= 120) return "bucket_61_120_days" as const;
    if (days <= 180) return "bucket_121_180_days" as const;
    return "bucket_180_plus_days" as const;
};

export class Srv1APARService {
    static getSrv1APARReport(type: ReportType, includeExportData = false) {
        const source = (type === "PAYABLE" ? payableRows : receivableRows) as SourceRow[];
        const headerRow = source.find(row => Object.values(row).some(value => value === "Date")) || {};
        const companyKey = Object.keys(headerRow).find(key => !key.startsWith("__EMPTY")) ||
            Object.keys(source[0] || {}).find(key => !key.startsWith("__EMPTY")) || "Company";
        const periodLabel = source
            .flatMap(row => Object.values(row))
            .find(value => typeof value === "string" && /^\d{1,2}-[A-Za-z]{3}-\d{2,4}\s+to\s+\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(value.trim())) as string | undefined;
        const period = parsePeriod(periodLabel || "");
        const companyName = companyKey || "A G Ashtavinayaka Petrochem Pvt Ltd - Maharashtra";
        const footerTotal = [...source].reverse().find(row =>
            !row["__EMPTY_1"] && Number.isFinite(Number(row["__EMPTY_2"])) && Number(row["__EMPTY_2"]) > 0
        )?.["__EMPTY_2"];
        const agencies = new Map<string, any>();
        const exportData: any[] = [];
        let parsedInvoiceCount = 0;
        let pendingTotal = 0;

        for (const raw of source) {
            const billDate = excelDate(raw[companyKey]);
            const billNo = String(raw.__EMPTY ?? "").trim();
            const agencyName = String(raw.__EMPTY_1 ?? "").replace(/[\r\n]+/g, " ").trim();
            const pendingAmount = amount(raw.__EMPTY_2);
            if (!billDate || !billNo || !agencyName || pendingAmount <= 0) continue;

            const dueDate = excelDate(raw.__EMPTY_3) || billDate;
            const sourceAge = Number(String(raw.__EMPTY_4 ?? "").trim());
            const agingDays = Number.isFinite(sourceAge) && sourceAge >= 0
                ? sourceAge
                : period.endDate
                    ? Math.max(Math.floor((period.endDate.getTime() - dueDate.getTime()) / 86400000), 0)
                    : 0;
            const agingBucket = bucketFor(agingDays);
            const agencyKey = agencyName.toLocaleLowerCase();
            const agencyId = `srv1-agency:${agencyKey.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
            let agency = agencies.get(agencyKey);
            if (!agency) {
                agency = {
                    agencyId,
                    agencyName,
                    vendorCode: "",
                    gstin: null,
                    branchName: companyName,
                    balanceType: type,
                    createdAt: billDate,
                    agingDays,
                    totalOutstanding: 0,
                    bucket_0_60_days: { amount: 0, invoices: [] as any[] },
                    bucket_61_120_days: { amount: 0, invoices: [] as any[] },
                    bucket_121_180_days: { amount: 0, invoices: [] as any[] },
                    bucket_180_plus_days: { amount: 0, invoices: [] as any[] }
                };
                agencies.set(agencyKey, agency);
            }

            if (billDate < agency.createdAt) agency.createdAt = billDate;
            agency.agingDays = Math.max(agency.agingDays, agingDays);
            agency.totalOutstanding += pendingAmount;
            agency[agingBucket].amount += pendingAmount;

            agency[agingBucket].invoices.push({
                invoiceId: `srv1-${type.toLowerCase()}-${parsedInvoiceCount + 1}`,
                invoiceType: type === "PAYABLE" ? "PURCHASE" : "SALE",
                invoiceNo: billNo,
                invoiceDate: billDate,
                invoiceAgeDays: agingDays,
                grandTotal: pendingAmount,
                originalGrandTotal: null,
                allocatedAmount: null,
                outstandingAmount: pendingAmount,
                settlementStatus: "UNKNOWN_FROM_SOURCE"
            });

            exportData.push({
                vendorCode: agencyId,
                vendorName: agencyName,
                billNo,
                billDate,
                dueDate,
                billAmount: null,
                gstAmount: null,
                tds: null,
                paidAmount: null,
                balanceAmount: pendingAmount,
                pendingAmount,
                agingDays,
                agingBucket,
                branch: companyName,
                remarks: "Tally pending amount; original invoice, GST, TDS, and paid totals are not included in the source JSON."
            });
            pendingTotal += pendingAmount;
            parsedInvoiceCount += 1;
        }

        const rows = [...agencies.values()].sort((a, b) => a.agencyName.localeCompare(b.agencyName));
        rows.forEach((row, index) => {
            row.vendorCode = `V${String(index + 1).padStart(3, "0")}`;
            row.balanceType = type;
            row.totalOutstanding = Number(row.totalOutstanding.toFixed(2));
            for (const bucket of [
                row.bucket_0_60_days,
                row.bucket_61_120_days,
                row.bucket_121_180_days,
                row.bucket_180_plus_days
            ]) bucket.amount = Number(bucket.amount.toFixed(2));
        });
        const vendorCodeById = new Map<string, string>(
            rows.map(row => [row.agencyId, row.vendorCode] as [string, string])
        );
        exportData.forEach(row => row.vendorCode = vendorCodeById.get(row.vendorCode) || row.vendorCode);

        const bucketTotal = (key: string) => rows.reduce((sum, row) => sum + amount(row[key]?.amount), 0);
        const summary = {
            totalAgencies: rows.length,
            totalInvoices: parsedInvoiceCount,
            totalOutstanding: Number(pendingTotal.toFixed(2)),
            bucket_0_60_days: bucketTotal("bucket_0_60_days"),
            bucket_61_120_days: bucketTotal("bucket_61_120_days"),
            bucket_121_180_days: bucketTotal("bucket_121_180_days"),
            bucket_180_plus_days: bucketTotal("bucket_180_plus_days")
        };

        return {
            reportName: type === "PAYABLE"
                ? "SRV1 Accounts Payable Aging Report"
                : "SRV1 Accounts Receivable Aging Report",
            generatedAt: new Date(),
            branchId: null,
            agency: null,
            agencyId: undefined,
            period: { ...period, label: periodLabel || null },
            summary,
            rows,
            diagnostics: {
                source: type === "PAYABLE" ? "SRV1/APAR/AP.json" : "SRV1/APAR/AR.json",
                sourceTitle: type === "PAYABLE" ? "Bills Payable" : "Bills Receivable",
                sourcePendingTotal: footerTotal == null ? null : amount(footerTotal),
                parsedPendingTotal: Number(pendingTotal.toFixed(2)),
                totalDifference: footerTotal == null ? null : Number((amount(footerTotal) - pendingTotal).toFixed(2)),
                sourceRowsParsed: parsedInvoiceCount,
                invoiceTotalPaidGstAndTdsAvailable: false
            },
            exportData: includeExportData ? exportData : undefined
        };
    }
}
