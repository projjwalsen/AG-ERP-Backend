import { ExportColumn } from "../../core/utils/export.service";


export const branchColumns: ExportColumn<any>[] = [
    {
        header: "Branch Code",
        key: "code",
        width: 20
    },
    {
        header: "Branch Name",
        key: "name",
        width: 30
    },
    {
        header: "GSTIN",
        key: "gstin",
        width: 25
    },
    {
        header: "State Code",
        key: "stateCode",
        width: 15
    },
    {
        header: "Phone Number",
        key: "phnNumber",
        width: 20
    },
    {
        header: "Email",
        key: "email",
        width: 30
    },
    {
        header: "City",
        key: "city",
        width: 20
    },
    {
        header: "State",
        key: "state",
        width: 20
    },
    {
        header: "Pincode",
        key: "pinCode",
        width: 15
    },
    {
        header: "Address",
        value: (row) =>
            [
                row.addressLine1,
                row.addressLine2
            ]
                .filter(Boolean)
                .join(", "),
        width: 50
    },
    {
        header: "Users",
        value: (row) =>
            row._count?.users || 0,
        width: 12
    },
    {
        header: "Status",
        value: (row) =>
            row.isActive
                ? "Active"
                : "Inactive",
        width: 15
    },
    {
        header: "Created Date",
        value: (row) =>
            row.createdAt
                ? new Date(row.createdAt)
                    .toLocaleDateString("en-IN")
                : "",
        width: 18
    }
];

export const branchDayBookColumns = [

    {
        header:"Date",
        key:"date",
        width:15
    },

    {
        header:"Particulars",
        key:"particulars",
        width:45
    },

    {
        header:"Vch Type",
        key:"voucherType",
        width:22
    },

    {
        header:"Vch No.",
        key:"voucherNo",
        width:20
    },

    {
        header:"Debit Amount",
        key:"debitAmount",
        width:18
    },

    {
        header:"Credit Amount",
        key:"creditAmount",
        width:18
    }

];

export const gstr1Columns = [
    {
        header: "Branch Name",
        key: "branchName",
        width: 25
    },

    {
        header: "Branch GSTIN",
        key: "branchGst",
        width: 25
    },

    {
        header: "Classification",
        key: "classification",
        width: 15
    },

    {
        header: "Customer GSTIN",
        key: "customer_gstin",
        width: 25
    },

    {
        header: "Invoice No",
        key: "invoice_number",
        width: 20
    },

    {
        header: "Invoice Date",
        value: row =>
            row.invoice_date
                ? new Date(row.invoice_date)
                    .toLocaleDateString("en-IN")
                : "",
        width: 18
    },

    {
        header: "Place Of Supply",
        key: "place_of_supply_pos",
        width: 20
    },

    {
        header: "Taxable Value",
        key: "taxable_value",
        width: 18
    },

    {
        header: "CGST Amount",
        key: "cgst_rate_amount",
        width: 18
    },

    {
        header: "SGST Amount",
        key: "sgst_rate_amount",
        width: 18
    },

    {
        header: "IGST Amount",
        key: "igst_rate_amount",
        width: 18
    },

    {
        header: "Invoice Total",
        key: "invoice_total",
        width: 18
    }
];

export const gstSuspenseColumns = [
    { header: "Suspense ID", key: "suspense_id" },
    { header: "Clearance Date", key: "bank_clearance_date" },
    { header: "Amount", key: "amount_received" },
    { header: "Payment Channel", key: "payment_channel" },
    { header: "Authentication Status", key: "auth_status" },
    { header: "Agency Name", key: "agency_name" },
    { header: "Remarks", key: "reported_remarks" }
];

export const stockInventoryColumns = [
    { header: "Product Code", key: "productCode" },
    { header: "Product Name", key: "productName" },
    { header: "Batch No", key: "batchId" },

    {
        header: "Branch",
        value: row => row.branch?.name
    },

    { header: "Stock KG", key: "stockKG" },
    { header: "Stock LTR", key: "stockLTR" },

    { header: "Created At", key: "createdAt" }
];

export const outstandingColumns = [
    {
        header: "Agency Name",
        key: "agency_name",
        width: 35
    },

    {
        header: "Branch",
        value: row => row.branch?.name,
        width: 25
    },

    {
        header: "GSTIN",
        key: "gstin",
        width: 25
    },

    {
        header: "Outstanding Amount",
        key: "total_outstanding",
        width: 20
    },

    {
        header: "Balance Type",
        key: "balanceType",
        width: 15
    },

    {
        header: "Created At",
        value: row =>
            new Date(row.createdAt)
                .toLocaleDateString("en-IN"),
        width: 18
    }
];

export const outstandingDetailColumns = [

    {
        header: "Agency Name",
        key: "vendorName",
        width: 35
    },

    {
        header: "Invoice No",
        key: "billNo",
        width: 22
    },

    {
        header: "Invoice Date",
        value: row =>
            row.billDate
                ? new Date(row.billDate)
                    .toLocaleDateString("en-IN")
                : "",
        width: 18
    },

    {
        header: "Due Date",
        value: row =>
            row.dueDate
                ? new Date(row.dueDate)
                    .toLocaleDateString("en-IN")
                : "",
        width: 18
    },

    {
        header: "Age (Days)",
        key: "agingDays",
        width: 15
    },

    {
        header: "Aging Bucket",
        key: "agingBucket",
        width: 18
    },

    {
        header: "Invoice Amount",
        key: "billAmount",
        width: 18
    },

    {
        header: "GST Amount",
        key: "gstAmount",
        width: 18
    },

    {
        header: "Paid Amount",
        key: "paidAmount",
        width: 18
    },

    {
        header: "Outstanding Amount",
        key: "balanceAmount",
        width: 20
    },

    {
        header: "Remarks",
        key: "remarks",
        width: 35
    }

];

export const outstandingAgingColumns = (
    type: "PAYABLE" | "RECEIVABLE"
) => [
    {
        header: "Vendor Code",
        key: "vendorCode",
        width: 15
    },

    {
        header: "Vendor / Customer",
        key: "agencyName",
        width: 35
    },

    {
        header:
            type === "PAYABLE"
                ? "Total Payable"
                : "Total Receivable",
        key: "totalOutstanding",
        width: 20
    },

    {
        header: "0-30 Days",
        value: row => row.bucket_0_30_days?.amount ?? 0,
        width: 18
    },

    {
        header: "31-60 Days",
        value: row => row.bucket_31_60_days?.amount ?? 0,
        width: 18
    },

    {
        header: "61-90 Days",
        value: row => row.bucket_61_90_days?.amount ?? 0,
        width: 18
    },

    {
        header: "Above 90 Days",
        value: row => row.bucket_91_plus_days?.amount ?? 0,
        width: 18
    },
];

export const accountingLedgerColumns = [
    { header: "Date", key: "date" },
    { header: "Voucher No", key: "voucherNo" },
    { header: "Particular", key: "particular" },
    { header: "Debit", key: "debit" },
    { header: "Credit", key: "credit" },
    { header: "Balance", key: "balance" }
];

export const cashBookColumns = [
    { header: "Date", key: "date" },
    { header: "Voucher No", key: "voucherNo" },
    { header: "Particular", key: "particular" },
    { header: "Debit", key: "debit" },
    { header: "Credit", key: "credit" },
    { header: "Balance", key: "balance" }
];

export const debtorLedgerColumns = [
    { header: "Date", key: "date" },
    { header: "Voucher No", key: "voucherNo" },
    { header: "Particular", key: "particular" },
    { header: "Debit", key: "debit" },
    { header: "Credit", key: "credit" },
    { header: "Balance", key: "balance" }
];

export const creditorLedgerColumns = [
    { header: "Date", key: "date" },
    { header: "Voucher No", key: "voucherNo" },
    { header: "Particular", key: "particular" },
    { header: "Debit", key: "debit" },
    { header: "Credit", key: "credit" },
    { header: "Balance", key: "balance" }
];

export const bankAccCashColumns = [

    {
        header: "Sr No",
        key: "serialNo"
    },

    {
        header: "Date",
        key: "date"
    },
    {
        header: "Branch",
        key: "branch"
    },

    {
        header: "Description",
        key: "description",
        width: 60
    },

    {
        header: "Income",
        key: "income"
    },

    {
        header: "Expense",
        key: "expense"
    },

    {
        header: "Balance",
        key: "balance"
    }
];