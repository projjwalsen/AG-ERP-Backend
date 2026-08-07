import { ExportColumn } from "../../core/utils/export.service";


export const inventoryBatchColumns: ExportColumn<any>[] = [
    {
        header: "Branch",
        key: "branch.name",
        width: 30
    },
    {
        header: "Product",
        key: "product.name",
        width: 40
    },
    {
        header: "SKU",
        key: "product.sku"
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
        key: "status"
    }
];