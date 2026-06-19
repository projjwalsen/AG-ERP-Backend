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
    { header: "Serial No", key: "serialNo" },
    { header: "Voucher ID", key: "voucherId" },
    { header: "Transaction Date", key: "transactionDate" },
    { header: "Agency", key: "primaryAgencyName" },
    { header: "Payment Mode", key: "paymentMode" },
    { header: "Payment Type", key: "paymentType" },
    { header: "Reference", key: "transactionRef" },
    { header: "Receipt", key: "cashInFlowReceipt" },
    { header: "Remarks", key: "remarks" }
];

export const gstr1Columns = [
    { header: "Classification", key: "classification" },
    { header: "Customer GSTIN", key: "customer_gstin" },
    { header: "Invoice No", key: "invoice_number" },
    { header: "Invoice Date", key: "invoice_date" },
    { header: "POS", key: "place_of_supply_pos" },
    { header: "Taxable Value", key: "taxable_value" },
    { header: "CGST", key: "cgst_rate_amount" },
    { header: "SGST", key: "sgst_rate_amount" },
    { header: "IGST", key: "igst_rate_amount" },
    { header: "Invoice Total", key: "invoice_total" }
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
    { header: "Agency Name", key: "agency_name" },
    { header: "Agency Type", key: "agency_type" },

    {
        header: "Branch",
        value: row => row.branch?.name
    },

    {
        header: "Ledger Code",
        value: row => row.ledger?.code
    },

    {
        header: "Ledger Name",
        value: row => row.ledger?.name
    },

    { header: "Opening Balance", key: "openingBalance" },
    { header: "Debit", key: "debit" },
    { header: "Credit", key: "credit" },
    { header: "Outstanding", key: "total_outstanding" },
    { header: "Balance Type", key: "balanceType" }
];