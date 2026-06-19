import { ExportColumn } from "../../core/utils/export.service";

export const transactionColumns: ExportColumn<any>[] = [
    {
        header: "Transaction No",
        key: "transactionNo",
        width: 25
    },
    {
        header: "Reference No",
        key: "transactionRefNo",
        width: 25
    },
    {
        header: "Date",
        value: row =>
            new Date(row.createdAt)
                .toLocaleDateString("en-IN"),
        width: 15
    },
    {
        header: "Direction",
        key: "direction",
        width: 15
    },
    {
        header: "Status",
        key: "status",
        width: 15
    },
    {
        header: "Payment Type",
        key: "paymentType",
        width: 20
    },
    {
        header: "Branch",
        value: row => row.branch?.name,
        width: 25
    },
    {
        header: "Agency",
        value: row => row.agency?.name,
        width: 30
    },
    {
        header: "Third Party Agency",
        value: row =>
            row.thirdPartyAgency?.name || "-",
        width: 30
    },
    {
        header: "Suspense Account",
        value: row =>
            row.suspenseAccount
                ? "Yes"
                : "No",
        width: 18
    },
    {
        header: "Created By",
        value: row =>
            row.createdBy?.name ||
            row.createdBy?.email,
        width: 25
    }
];