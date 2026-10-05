import gstr1Source from "./fakeGSTR-1/GSTR-1 (1).json";

type SourceRow = Record<string, string | number | null | undefined>;

const valueFor = (rows: SourceRow[], label: string) =>
    rows.find(row => Object.values(row).some(value => value === label));

const amount = (value: unknown) => {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
};

const parseTallyDate = (value: string) => {
    const match = value.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (!match) return null;
    const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
        .indexOf(match[2].toUpperCase());
    if (month < 0) return null;
    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return new Date(Date.UTC(year, month, Number(match[1])));
};

export class FakeGSTR1Service {
    static getFakeGSTR1Report() {
        const rows = gstr1Source as SourceRow[];
        const companyName = Object.keys(rows[0] || {})[0] || "Company";
        const registration = valueFor(rows, "GST Registration:");
        const statusRow = valueFor(rows, "Status:");
        const periodLabel = rows
            .flatMap(row => Object.values(row))
            .find(value => typeof value === "string" && /^\d{1,2}-[A-Za-z]{3}-\d{2,4}\s+to\s+\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(value.trim())) as string | undefined;
        const [fromLabel, toLabel] = (periodLabel || "").split(/\s+to\s+/i);
        const b2bSource = valueFor(rows, "B2B Invoices - 4A, 4B, 4C, 6B, 6C");
        const taxableSource = valueFor(rows, "Taxable Sales") || b2bSource;
        const noteSource = valueFor(rows, "Credit or Debit Notes (Registered) - 9B");
        const grandTotalSource = valueFor(rows, "Total");

        const toSummary = (source: SourceRow | undefined, agencyName: string) => ({
            agency_id: null,
            customer_gstin: null,
            agency_name: agencyName,
            voucher_count: amount(source?.__EMPTY),
            taxable_value: amount(source?.__EMPTY_2),
            igst_rate_amount: amount(source?.__EMPTY_3),
            cgst_rate_amount: amount(source?.__EMPTY_4),
            sgst_rate_amount: amount(source?.__EMPTY_5),
            cess_amount: amount(source?.__EMPTY_6),
            gst_amount: amount(source?.__EMPTY_7),
            invoice_total: amount(source?.__EMPTY_8)
        });

        const b2bSummary = taxableSource ? [toSummary(taxableSource, "Taxable Sales")] : [];
        const creditDebitNoteSummary = noteSource
            ? [{ ...toSummary(noteSource, ""), summaryOnly: true }]
            : [];
        const b2b = b2bSummary[0];
        const summary = {
            totalInvoices: b2b?.voucher_count || 0,
            b2bInvoices: b2b?.voucher_count || 0,
            b2cInvoices: 0,
            totalTaxableValue: b2b?.taxable_value || 0,
            totalCGST: b2b?.cgst_rate_amount || 0,
            totalSGST: b2b?.sgst_rate_amount || 0,
            totalIGST: b2b?.igst_rate_amount || 0,
            totalGST: Number(((b2b?.cgst_rate_amount || 0) + (b2b?.sgst_rate_amount || 0) + (b2b?.igst_rate_amount || 0)).toFixed(2)),
            totalInvoiceValue: b2b?.invoice_total || 0
        };

        const statusValue = (label: string) => amount(valueFor(rows, label)?.__EMPTY);
        const gstrStatus = {
            totalVouchers: statusValue("Total Vouchers"),
            includedInReturn: statusValue("Included in Return"),
            readyForUpload: statusValue("Ready for Upload"),
            modifiedAfterExport: statusValue("Modified in Books After Upload/Export"),
            noActionRequired: statusValue("No Action Required"),
            notRelevant: statusValue("Not Relevant for This Return"),
            uncertain: statusValue("Uncertain Transactions (Corrections needed)"),
            markedForDeletion: statusValue("Marked for Deletion on Portal"),
            conflictsWithMasters: statusValue("Vouchers Having Conflicts with Masters"),
            filingStatus: String(statusRow?.__EMPTY || ""),
            lastOnlineActivity: String(statusRow?.__EMPTY_1 || "")
        };

        return {
            reportName: "GSTR-1 Outward Supplies Report",
            generatedAt: new Date(),
            period: {
                startDate: parseTallyDate(fromLabel || ""),
                endDate: parseTallyDate(toLabel || ""),
                label: periodLabel || null
            },
            branchId: null,
            branch: {
                name: companyName,
                branchName: companyName,
                gstin: String(registration?.__EMPTY || ""),
                branchGst: String(registration?.__EMPTY || "")
            },
            summary,
            b2bSummary,
            creditDebitNoteSummary,
            rows: [],
            gstrStatus,
            diagnostics: {
                source: "fakeGSTR-1/GSTR-1 (1).json",
                voucherLevelRowsAvailable: false,
                sourceB2BSummary: b2bSource ? toSummary(b2bSource, "B2B Invoices") : null,
                sourceGrandTotal: grandTotalSource ? toSummary(grandTotalSource, "Total") : null,
                creditDebitNotesIncludedInReturn: true
            }
        };
    }
}
