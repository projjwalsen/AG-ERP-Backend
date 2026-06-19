export const ledgerColumns = [
    {
        header: "Ledger Code",
        key: "code"
    },
    {
        header: "Ledger Name",
        key: "name"
    },
    {
        header: "Category",
        key: "category"
    },
    {
        header: "Nature",
        key: "nature"
    },
    {
        header: "Group Code",
        value: row => row.group?.code
    },
    {
        header: "Group Name",
        value: row => row.group?.name
    },
    {
        header: "Branch",
        value: row => row.branch?.name
    },
    {
        header: "Agency",
        value: row => row.agency?.name
    },
    {
        header: "Opening Balance",
        key: "openingBalance"
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
        header: "Closing Balance",
        key: "closingBalance"
    },
    {
        header: "Balance Type",
        key: "balanceType"
    },
    {
        header: "GSTIN",
        key: "gstin"
    },
    {
        header: "PAN",
        key: "pan"
    },
    {
        header: "Status",
        value: row =>
            row.isActive
                ? "Active"
                : "Inactive"
    }
];


export const branchLedgerColumns = [
    {
        header: "Branch Code",
        key: "code"
    },
    {
        header: "Branch Name",
        key: "name"
    },
    {
        header: "GSTIN",
        key: "gstin"
    },
    {
        header: "Ledger Count",
        key: "ledgerCount"
    },
    {
        header: "Opening Balance",
        key: "openingBalance"
    },
    {
        header: "Debit",
        key: "totalDebit"
    },
    {
        header: "Credit",
        key: "totalCredit"
    },
    {
        header: "Closing Balance",
        key: "closingBalance"
    }
];

export const agencyLedgerColumns = [
    {
        header: "Agency",
        key: "name"
    },
    {
        header: "GSTIN",
        key: "gstin"
    },
    {
        header: "Ledger Count",
        key: "ledgerCount"
    },
    {
        header: "Opening Balance",
        key: "openingBalance"
    },
    {
        header: "Debit",
        key: "totalDebit"
    },
    {
        header: "Credit",
        key: "totalCredit"
    },
    {
        header: "Closing Balance",
        key: "closingBalance"
    }
];

export const suspenseLedgerColumns = [
    {
        header: "Transaction No",
        key: "transactionNo"
    },
    {
        header: "Branch",
        value: row => row.branch?.name
    },
    {
        header: "Agency",
        value: row => row.agency?.name
    },
    {
        header: "Direction",
        key: "direction"
    },
    {
        header: "Amount",
        key: "amount"
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
        header: "Remarks",
        key: "remarks"
    }
];