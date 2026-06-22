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
        header: "Serial No",
        key: "serialNo"
    },

    {
        header: "Voucher ID",
        key: "voucherId"
    },

    {
        header: "Transaction Date",
        key: "transactionDate"
    },

    {
        header: "Agency",
        key: "primaryAgencyName"
    },

    {
        header: "Third Party Agency",
        key: "secondaryAgencyName"
    },

    {
        header: "Payment Mode",
        key: "paymentMode"
    },

    {
        header: "Payment Type",
        key: "paymentType"
    },

    {
        header: "Reference",
        key: "transactionRef"
    },

    {
        header: "Debit",
        key: "debit"
    },

    {
        header: "Credit",
        key: "credit"
    },

    {
        header: "Balance",
        key: "runningBalance"
    },

    {
        header: "Remarks",
        key: "remarks"
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

export const accountingLedgerColumns: ExportColumn<any>[] = [

    {
        header: "Date",
        key: "date",
        width: 18
    },

    {
        header: "Transaction No",
        key: "transactionNo",
        width: 25
    },

    {
        header: "Direction",
        key: "direction",
        width: 15
    },

    {
        header: "Agency",
        key: "agency",
        width: 35
    },

    {
        header: "Payment Mode",
        key: "paymentMode",
        width: 20
    },

    {
        header: "Reference No",
        key: "transactionRefNo",
        width: 25
    },

    {
        header: "Inward",
        key: "inward",
        width: 18
    },

    {
        header: "Outward",
        key: "outward",
        width: 18
    },

    {
        header: "Running Balance",
        key: "runningBalance",
        width: 20
    },
];

export const cashBookColumns: ExportColumn<any>[] = [

    {
        header: "Date",
        key: "date",
        width: 18
    },

    {
        header: "Voucher No",
        key: "voucherNo",
        width: 25
    },

    {
        header: "Voucher Type",
        key: "voucherType",
        width: 20
    },

    {
        header: "Particulars",
        key: "particulars",
        width: 40
    },

    {
        header: "Receipt",
        key: "receipt",
        width: 18
    },

    {
        header: "Payment",
        key: "payment",
        width: 18
    },

    {
        header: "Narration",
        key: "narration",
        width: 50
    }
];

export const debtorLedgerColumns: ExportColumn<any>[] = [

    {
        header: "Ledger Code",
        key: "ledgerCode"
    },

    {
        header: "Ledger Name",
        key: "ledgerName"
    },

    {
        header: "Date",
        key: "date"
    },

    {
        header: "Voucher No",
        key: "voucherNo"
    },

    {
        header: "Voucher Type",
        key: "voucherType"
    },

    {
        header: "Debit",
        key: "debit"
    },

    {
        header: "Credit",
        key: "credit"
    },

    {
        header: "Running Balance",
        key: "runningBalance"
    },

    {
        header: "Balance Type",
        key: "balanceType"
    },

    {
        header: "Narration",
        key: "narration"
    }
];

export const creditorLedgerColumns: ExportColumn<any>[] = [

    {
        header: "Ledger Code",
        key: "ledgerCode"
    },

    {
        header: "Ledger Name",
        key: "ledgerName"
    },

    {
        header: "Date",
        key: "date"
    },

    {
        header: "Voucher No",
        key: "voucherNo"
    },

    {
        header: "Voucher Type",
        key: "voucherType"
    },

    {
        header: "Debit",
        key: "debit"
    },

    {
        header: "Credit",
        key: "credit"
    },

    {
        header: "Running Balance",
        key: "runningBalance"
    },

    {
        header: "Balance Type",
        key: "balanceType"
    },

    {
        header: "Narration",
        key: "narration"
    }
];