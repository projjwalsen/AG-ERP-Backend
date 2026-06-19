import { ExportColumn } from "../../core/utils/export.service";


export const productColumns: ExportColumn<any>[] = [
  {
    header: "SKU",
    key: "sku",
    width: 20,
  },
  {
    header: "Product Name",
    key: "name",
    width: 40,
  },
  {
    header: "Category",
    value: row => row.category
  },
  {
    header: "Base Unit",
    key: "baseUnit",
  },
  {
    header: "GST %",
    key: "applicableGST",
  },
  {
    header: "Sell Price",
    key: "sellPricePerUnit",
  },
  {
    header: "Status",
    value: row => row.isActive ? "Active" : "Inactive"
  }
];