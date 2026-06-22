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


export const productMovementColumns = [
    {
        header: "Date",
        value: row =>
            row.entryDate
                ? new Date(row.entryDate)
                    .toLocaleDateString("en-IN")
                : ""
    },

    {
        header: "Movement Type",
        key: "movementType",
        width: 20
    },

    {
        header: "Direction",
        key: "direction",
        width: 15
    },

    {
        header: "Branch",
        value: row => row.branch?.name || "-"
    },

    {
        header: "Agency",
        value: row => row.agency?.name || "-"
    },

    {
        header: "Invoice No",
        key: "invoiceNo"
    },

    {
        header: "Batch No",
        key: "batchNo"
    },

    {
        header: "Quantity KG",
        key: "quantityKG"
    },

    {
        header: "Running Stock KG",
        key: "runningStockKG"
    },

    {
        header: "Unit Cost",
        key: "unitCost"
    },

    {
        header: "Total Cost",
        key: "totalCost"
    },

    {
        header: "Remarks",
        key: "remarks",
        width: 35
    },

    {
        header: "Created By",
        value: row =>
            row.createdBy?.name ||
            row.createdBy?.email ||
            "-"
    }
];