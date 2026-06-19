import { ExportColumn } from "../../core/utils/export.service";

export const inventorySummaryColumns: ExportColumn<any>[] = [
    {
        header: "Product",
        key: "name"
    },
    {
        header: "SKU",
        key: "sku"
    },
    {
        header: "Total Stock KG",
        key: "totalStockKG"
    },
    {
        header: "Total Stock LTR",
        key: "totalStockLTR"
    },
    {
        header: "Minimum Stock KG",
        key: "minimumStockKG"
    },
    {
        header: "Branch Count",
        key: "branchCount"
    },
    {
        header: "Status",
        key: "status"
    }
];

export const productBatchHistoryColumns: ExportColumn<any>[] = [
    {
        header: "Branch",
        key: "branchName",
        width: 30
    },
    {
        header: "Branch Code",
        key: "branchCode"
    },
    {
        header: "Batch No",
        key: "batchNo"
    },
    {
        header: "Purchase Price",
        key: "purchasePrice"
    },
    {
        header: "Available KG",
        key: "availableQtyKG"
    },
    {
        header: "Available LTR",
        key: "availableQtyLTR"
    },
    {
        header: "Status",
        value: row =>
            row.isActive
                ? "Active"
                : "Inactive"
    },
    {
        header: "Created At",
        value: row =>
            new Date(
                row.createdAt
            ).toLocaleDateString()
    }
];