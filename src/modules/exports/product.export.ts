import { ExportColumn } from "../../core/utils/export.service";

export const productLedgerColumns: ExportColumn<any>[] = [
    {
        header: "Ledger Code",
        key: "code",
        width: 20
    },
    {
        header: "Product SKU",
        key: "productSKU",
        width: 20
    },
    {
        header: "Product Name",
        key: "productName",
        width: 35
    },
    {
        header: "Category",
        key: "productCategory",
        width: 20
    },
    {
        header: "Base Unit",
        key: "baseUnit",
        width: 15
    },
    {
        header: "Current Stock (KG)",
        key: "globalStockKG",
        width: 20
    },
    {
        header: "Current Stock (LTR)",
        key: "globalStockLTR",
        width: 20
    },
    {
        header: "Minimum Stock (KG)",
        key: "minimumStockKG",
        width: 20
    },
    {
        header: "Sell Price",
        key: "sellPricePerUnit",
        width: 18
    },
    {
        header: "Stock Status",
        value: row =>
            row.isLowStock
                ? "Low Stock"
                : "Normal",
        width: 18
    },
    {
        header: "Status",
        value: row =>
            row.isActive
                ? "Active"
                : "Inactive",
        width: 15
    }
];