import * as XLSX from "xlsx";
import { AgencyImportDTO, ExcelRowDTO, GroupedVoucherDTO, JournalImportDTO, ProductImportDTO } from "../../core/dto/dto";
import { AgencyType } from "@prisma/client";
export class ExcelImportService {

    /**
     * ======================================================
     * Reads workbook
     * ======================================================
    */
    static readExcel(buffer: Buffer): XLSX.WorkBook {

        return XLSX.read(buffer, {
            type: "buffer",
            cellDates: true,
            raw: false
        });

    }


    private static getValue(
        row: Record<string, any>,
        ...headers: string[]
    ) {

         if (!row) {
        return undefined;
    }

    for (const header of headers) {

        const value =
            row[this.normalizeHeader(header)];

        if (
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ""
        ) {
            return value;
        }
    }

    return undefined;

    }

    private static toNumber(value: any): number {

        if (value === undefined || value === null || value === "")
            return 0;

        if (typeof value === "number")
            return value;

        const cleaned = String(value)

            .replace(/Dr/gi, "")
            .replace(/Cr/gi, "")

            // remove every unit variation
            .replace(/\/?\s*KGS?\.?/gi, "")
            .replace(/\/?\s*KG\.?/gi, "")
            .replace(/\/?\s*LTRS?\.?/gi, "")
            .replace(/\/?\s*LTR\.?/gi, "")
            .replace(/\/?\s*LITRES?\.?/gi, "")
            .replace(/\/?\s*MTS?\.?/gi, "")
            .replace(/\/?\s*MT\.?/gi, "")

            .replace(/,/g, "")

            .trim();

        const number = Number(cleaned);

        return Number.isFinite(number)
            ? number
            : 0;
    }

    private static parseRoundOff(value: any): number {

        if (!value) return 0;

        const text = String(value).trim();

        const amount = this.toNumber(text);

        if (/Cr/i.test(text)) {

            return -amount;

        }

        return amount;

    }

    public static toDate(value: any): Date | undefined {

        if (!value)
            return undefined;

        const date = new Date(value);

        return isNaN(date.getTime())
            ? undefined
            : date;

    }

    /**
     * ======================================================
     * Returns Worksheet
     * ======================================================
    */
    static getWorkSheet(
        workbook: XLSX.WorkBook,
        sheetName?: string
    ): any {
        const name =
            sheetName || workbook.SheetNames[0];

        const sheet = workbook.Sheets[name];

        if (!sheet) {
            throw new Error(
                `Sheet not found: ${name}`
            )
        }

        return sheet;
    }

    /**
     * Normalize Header
    */
    static normalizeHeader(header: string): string {

        return String(header ?? "")

            .replace(/\n/g, " ")

            .replace(/\r/g, " ")

            .replace(/\s+/g, " ")

            .replace(/[.:]/g, "")

            .trim()

            .toLowerCase();

    }

    /**
     * Normalize all keys
    */
    static normalizeHeaders(
        row: Record<string, any>
    ): Record<string, any> {

        const normalized: Record<string, any> = {};

        for (const key of Object.keys(row)) {

            normalized[
                this.normalizeHeader(key)
            ] = row[key];

        }

        return normalized;
    }

    /**
     * Reading worksheet as JSON
    **/
    static readRows(
        worksheet: XLSX.WorkSheet,
        options?: {

            headerRow?: number;

        }
    ): Record<string, any>[] {

        const {

            headerRow = 8

        } = options ?? {};

        const rows =
            XLSX.utils.sheet_to_json<Record<string, any>>(

                worksheet,

                {

                    range: headerRow - 1,

                    defval: "",

                    raw: false

                }

            );

        return rows.map(row =>
            this.normalizeHeaders(row)
        );

    }

    static readProductRows(
        worksheet: XLSX.WorkSheet
    ): Record<string, any>[] {

        const rows = XLSX.utils.sheet_to_json<any>(
            worksheet,
            {
                header: 1,
                defval: ""
            }
        );

        const result: Record<string, any>[] = [];

        // Row index 4 -> Opening Balance/Inwards...
        const groupHeaders = rows[4] ?? [];

        // Row index 5 -> Quantity/Rate/Value...
        const subHeaders = rows[5] ?? [];

        for (let r = 6; r < rows.length; r++) {

            const row = rows[r];

            result.push({

                particulars: row[0],

                openingBalanceQuantity: row[1],

                openingBalanceRate: row[2],

                openingBalanceValue: row[3]

            });

        }

        return result;
    }

    static parseRows(
        rows: Record<string, any>[],
        type: "PURCHASE" | "SALE" = "PURCHASE"
    ): ExcelRowDTO[] {

        return rows.map((row, index) => {

            let effectiveRow = row;

            let particulars = String(
                this.getValue(row, "Particulars") || ""
            );

            let disclaimer = "";

            if (type === "SALE") {

                const nextRow = rows[index + 1];

                if (nextRow) {

                    const nextVoucher = String(
                        this.getValue(nextRow, "Voucher No") || ""
                    ).trim();

                    const nextProduct = String(
                        this.getValue(nextRow, "Particulars") || ""
                    ).trim();

                    const nextRate = this.toNumber(
                        this.getValue(nextRow, "Rate")
                    );

                    if (
                        !nextVoucher &&
                        nextProduct &&
                        (nextRate > 0 || nextProduct)
                    ) {

                        effectiveRow = nextRow;

                        particulars = nextProduct;

                        const disclaimerLines: string[] = [];

                        let i = index + 2;

                        while (i < rows.length) {

                            const currentRow = rows[i];

                            if (!currentRow) {
                                break;
                            }

                            const voucher = String(
                                this.getValue(currentRow, "Voucher No") || ""
                            ).trim();

                            if (voucher) {
                                break;
                            }

                            const text = String(
                                this.getValue(currentRow, "Particulars") || ""
                            ).trim();

                            if (text) {
                                disclaimerLines.push(text);
                            }

                            i++;
                        }

                        disclaimer = disclaimerLines.join("\n");
                    }
                }
            }


            const voucherNo = String(
                this.getValue(
                    row,
                    "Voucher No"
                ) || ""
            ).trim();

            /**
             * Skip rows having no Voucher No.
             * These are usually blank/footer rows.
             */
            if (!voucherNo) {
                return null as any;
            }

            /**
             * Product Name
             */
            const hsnNo =
                particulars.match(/\((\d{4,8})\)/)?.[1];

            const agencyName =
                String(
                    this.getValue(
                        row,
                        "Supplier",
                        "Buyer"
                    ) || ""
                )
                    .trim()
                    .toUpperCase();

            const productName =
                particulars

                    .replace(/\(\d{4,8}\)/g, "")

                    .replace(/\s*[-–]\s*(KG|KGS|LTR|LTRS|MT|MTS)\b/gi, "")

                    .replace(/\b(KG|KGS|LTR|LTRS|MT|MTS)\b/gi, "")

                    .replace(/\s+/g, " ")

                    .trim()

                + (hsnNo ? ` - ${hsnNo}` : "");

            const normalizedProduct =
                productName
                    .replace(/\s+/g, " ")
                    .trim()
                    .toUpperCase();

            /**
             * Ignore party/header rows in Sales Register.
             * Example:
             * Buyer == Particulars
             */
            if (
                normalizedProduct &&
                agencyName &&
                normalizedProduct === agencyName
            ) {
                return null as any;
            }



            /**
             * Quantity
             */
            const quantityText =
                String(
                    this.getValue(
                        row,
                        "Quantity"
                    ) || ""
                );

            let quantity =
                this.toNumber(quantityText);

            const value =
                this.toNumber(
                    this.getValue(
                        row,
                        "Value"
                    )
                );



            /**
             * Skip only completely empty rows.
             * Keep ledger/service rows because
             * they belong to the voucher.
             */
            if (
                quantity === 0 &&
                value === 0 &&
                !productName
            ) {

                return null as any;

            }

            /**
             * Unit
             */
            let unit = "KG";

            if (/MTS?|MT/i.test(quantityText)) {

                quantity *= 1000;

                unit = "KG";

            }

            else if (/LTR|LTRS|LITRE|LITRES/i.test(quantityText)) {

                unit = "LTR";

            }

            else if (/KGS?/i.test(quantityText)) {

                unit = "KG";

            }

            /**
             * fallback from Product Name
             */

            if (
                !/KG|LTR|MT/i.test(quantityText)
            ) {

                if (/LTR/i.test(productName))
                    unit = "LTR";

                if (/KG/i.test(productName))
                    unit = "KG";

            }

            /**
             * Rate
             */

            const rateText =
                String(
                    this.getValue(
                        effectiveRow,
                        "Rate"
                    ) || ""
                );

            let rate =
                this.toNumber(rateText);

            if (/\/MT/i.test(rateText)) {

                rate /= 1000;

            }

            console.log({
                voucher: this.getValue(row, "Voucher No"),
                particulars: productName,
                quantityText,
                quantity,
                rateText,
                value
            });

            /**
             * Calculate rate if Excel leaves it blank.
             * Tally Purchase/Sales Register often exports
             * Quantity + Value but no Rate.
             */
            if (
                rate === 0 &&
                quantity > 0
            ) {

                const value =
                    this.toNumber(
                        this.getValue(
                            row,
                            "Value"
                        )
                    );

                if (value > 0) {

                    rate = Number(
                        (
                            value / quantity
                        ).toFixed(2)
                    );

                }

            }

            /**
             * GST
             */

            const cgst =
                this.toNumber(
                    this.getValue(
                        row,
                        "Input CGST 9%",
                        "Output CGST 9%",
                        "INPUT CGST",
                        "OUTPUT CGST"
                    )
                );

            const sgst =
                this.toNumber(
                    this.getValue(
                        row,
                        "Input SGST 9%",
                        "Output SGST 9%",
                        "INPUT SGST",
                        "OUTPUT SGST"
                    )
                );

            const igst =
                this.toNumber(
                    this.getValue(
                        row,
                        "INPUT IGST 18%",
                        "OUTPUT IGST 18%",
                        "INPUT IGST",
                        "OUTPUT IGST"
                    )
                );

            const taxableAmount =
                this.toNumber(
                    this.getValue(
                        row,
                        "Value"
                    )
                );

            const gstAmount =
                cgst + sgst + igst;

            const gstPercent =
                taxableAmount > 0
                    ? Number(
                        (
                            gstAmount /
                            taxableAmount *
                            100
                        ).toFixed(2)
                    )
                    : 0;

            console.log({
                particulars: productName,
                taxableAmount,
                cgst,
                sgst,
                igst,
                gstAmount,
                gstPercent
            });


            const dto: ExcelRowDTO = {

                voucherDate:
                    this.toDate(
                        this.getValue(row, "Date")
                    ),

                voucherType:
                    String(
                        this.getValue(
                            row,
                            "Voucher Type"
                        ) || ""
                    ).trim(),

                voucherNo,

                invoiceNo:
                    String(
                        this.getValue(
                            row,
                            "Supplier Invoice No",
                            "Invoice No"
                        ) || ""
                    ).trim(),

                otherReferenceNo:
                    String(
                        this.getValue(
                            row,
                            "Other References"
                        ) || ""
                    ).trim(),


                invoiceDate:
                    this.toDate(
                        this.getValue(
                            row,
                            "Supplier Invoice Date",
                            "Invoice Date"
                        )
                    ),

                agencyName: agencyName,

                agencyAddress:
                    this.getValue(
                        row,
                        "Supplier Address",
                        "Buyer Address"
                    ),

                agencyGSTIN:
                    this.getValue(
                        row,
                        "GSTIN/UIN",
                        "Buyer GSTIN",
                        "GSTIN"
                    ),

                agencyPAN:
                    this.getValue(
                        row,
                        "PAN"
                    ),

                branchName:
                    this.getValue(
                        row,
                        "Consignee"
                    ),

                branchAddress:
                    this.getValue(
                        row,
                        "Consignee Address"
                    ),

                particulars: productName,

                disclaimer,

                hsnNo,

                quantity,

                unit,

                rate,

                taxableAmount,

                cgst,

                sgst,

                igst,

                gstPercent,

                roundOff:
                    this.parseRoundOff(
                        this.getValue(
                            row,
                            "R/OFF"
                        )
                    ),

                grandTotal:
                    this.toNumber(
                        this.getValue(
                            row,
                            "Gross Total"
                        )
                    ),

                narration:
                    this.getValue(
                        row,
                        "Narration"
                    ),

                transport: {

                    purchaseOrderNo:
                        this.getValue(
                            row,
                            "Order No."
                        ),

                    purchaseOrderDate:
                        this.toDate(
                            this.getValue(
                                row,
                                "Order Date"
                            )
                        ),

                    receiptNoteNo:
                        this.getValue(
                            row,
                            "Receipt Note No."
                        ),

                    receiptNoteDate:
                        this.toDate(
                            this.getValue(
                                row,
                                "Receipt Note Date"
                            )
                        ),

                    lrNo:
                        this.getValue(
                            row,
                            "L.R. No."
                        ),

                    dispatchThrough:
                        this.getValue(
                            row,
                            "Dispatch Through"
                        ),

                    destination:
                        this.getValue(
                            row,
                            "Destination"
                        ),

                    vehicleOrFlightNo:
                        this.getValue(
                            row,
                            "Vessel/Flight No."
                        ),

                    portOfLoading:
                        this.getValue(
                            row,
                            "Port of Loading"
                        ),

                    portOfDischarge:
                        this.getValue(
                            row,
                            "Port of Discharge"
                        ),

                    countryTo:
                        this.getValue(
                            row,
                            "Country To"
                        ),

                    billOfEntryNo:
                        this.getValue(
                            row,
                            "Bill of Entry No."
                        ),

                    billOfEntryDate:
                        this.toDate(
                            this.getValue(
                                row,
                                "Bill of Entry Date"
                            )
                        ),

                    portCode:
                        this.getValue(
                            row,
                            "Port Code"
                        )

                },

                raw: row

            };

            return dto;

        })
            .filter(Boolean)

    }

    static groupAndValidateVouchers(
        rows: ExcelRowDTO[],
        type: "PURCHASE" | "SALE" = "PURCHASE"
    ): GroupedVoucherDTO[] {

        const voucherMap =
            new Map<string, GroupedVoucherDTO>();

        for (const row of rows) {

            /**
             * Ignore empty rows
             */
            if (
                !row.voucherNo ||
                !row.voucherType
            ) {
                continue;
            }
            if (
                type === "SALE" &&
                !row.agencyName
            ) {
                continue;
            }

            /**
             * Ignore RCM Purchase
             */
            if (
                row.voucherType
                    .toUpperCase()
                    .includes("RCM PURCHASE")
            ) {
                continue;
            }

            /**
             * Purchase & Tax Invoice only
             */
            if (
                ![
                    "PURCHASE",
                    "TAX INVOICE"
                ].includes(
                    row.voucherType
                        .toUpperCase()
                )
            ) {
                continue;
            }

            const key =
                `${row.voucherType}_${row.voucherNo}`;

            if (!voucherMap.has(key)) {

                voucherMap.set(key, {

                    voucherType:
                        row.voucherType,

                    voucherNo:
                        row.voucherNo,

                    voucherDate:
                        row.voucherDate,

                    invoiceNo:
                        row.invoiceNo,

                    invoiceDate:
                        row.invoiceDate,

                    agencyName:
                        row.agencyName,

                    agencyAddress:
                        row.agencyAddress,

                    otherReferenceNo:
                        row.otherReferenceNo,

                    agencyGSTIN:
                        row.agencyGSTIN,

                    agencyPAN:
                        row.agencyPAN,

                    branchName:
                        row.branchName,

                    branchAddress:
                        row.branchAddress,

                    narration:
                        row.narration,

                    rows: []

                });

            }

            voucherMap
                .get(key)!
                .rows
                .push(row);

        }

        /**
         * Voucher Validation
         */
        const vouchers =
            Array.from(voucherMap.values());

        for (const voucher of vouchers) {

            voucher.importedTotals = {

                subTotal:

                    Number(

                        voucher.rows
                            .reduce(
                                (sum, row) =>
                                    sum + (row.taxableAmount || 0),
                                0
                            )
                            .toFixed(2)

                    ),

                totalCGST:

                    Number(

                        voucher.rows
                            .reduce(
                                (sum, row) =>
                                    sum + (row.cgst || 0),
                                0
                            )
                            .toFixed(2)

                    ),

                totalSGST:

                    Number(

                        voucher.rows
                            .reduce(
                                (sum, row) =>
                                    sum + (row.sgst || 0),
                                0
                            )
                            .toFixed(2)

                    ),

                totalIGST:

                    Number(

                        voucher.rows
                            .reduce(
                                (sum, row) =>
                                    sum + (row.igst || 0),
                                0
                            )
                            .toFixed(2)

                    ),

                totalGST:

                    Number(

                        voucher.rows
                            .reduce(
                                (sum, row) =>
                                    sum +
                                    (row.cgst || 0) +
                                    (row.sgst || 0) +
                                    (row.igst || 0),
                                0
                            )
                            .toFixed(2)

                    ),

                roundOff:
                    voucher.rows[0]?.roundOff || 0,

                grandTotal:
                    voucher.rows[0]?.grandTotal || 0

            };


            if (!voucher.agencyName) {

                if (type === "SALE") {
                    continue;
                }

            }

            if (!voucher.branchName) {

                if (type === "SALE") {
                    continue;
                }

            }

            if (voucher.rows.length === 0) {

                throw new Error(
                    `No Items found in Voucher ${voucher.voucherNo}`
                );

            }

            for (const item of voucher.rows) {

                if (!item.particulars) {

                    throw new Error(
                        `Product missing in Voucher ${voucher.voucherNo}`
                    );

                }

                if (
                    item.quantity <= 0 &&
                    item.taxableAmount > 0
                ) {

                    continue;

                }

                if (item.quantity < 0) {

                    throw new Error(
                        `Invalid Quantity in Voucher ${voucher.voucherNo}`
                    );

                }

                if (
                    item.rate === undefined ||
                    item.rate === null
                ) {

                    throw new Error(
                        `Rate missing in Voucher ${voucher.voucherNo}`
                    );

                }

            }

        }

        return vouchers;

    }

    static parseAgencyRows(
        rows: Record<string, any>[]
    ): AgencyImportDTO[] {

        const agencies =
            new Map<string, AgencyImportDTO>();

        for (const row of rows) {

            const agencyName =
                String(
                    this.getValue(
                        row,
                        "Agency Name",
                        "Name"
                    ) || ""
                ).trim();

            if (!agencyName) {
                continue;
            }

            const gstin =
                String(
                    this.getValue(
                        row,
                        "GSTIN",
                        "GSTIN/UIN"
                    ) || ""
                ).trim();

            const key =
                gstin ||
                agencyName.toUpperCase();

            if (agencies.has(key)) {
                continue;
            }

            const typeText =
                String(
                    this.getValue(
                        row,
                        "Type"
                    ) || "BOTH"
                )
                    .trim()
                    .toUpperCase();

            let type: AgencyType;

            switch (typeText) {
                case "CLIENT":

                    type = AgencyType.CLIENT;
                    break;

                case "VENDOR":

                    type = AgencyType.VENDOR;
                    break;

                case "BOTH":

                    type = AgencyType.BOTH;
                    break;

                default:

                    throw new Error(
                        `Invalid Agency Type '${typeText}' for ${agencyName}`
                    );
            }


            agencies.set(key, {

                agencyName,

                agencyAddress:
                    String(
                        this.getValue(
                            row,
                            "Address"
                        ) || ""
                    ).trim(),

                agencyGSTIN:
                    gstin,

                agencyPAN:
                    String(
                        this.getValue(
                            row,
                            "PAN"
                        ) || ""
                    ).trim(),

                openingBalance:
                    this.toNumber(
                        this.getValue(
                            row,
                            "OpeningBalance",
                            "Opening Balance",
                            "Opening Balance (Dr)",
                            "Opening Balance (Cr)",
                            "Opening"
                        )
                    ),

                type

            });

        }

        return [...agencies.values()];

    }

    static parseProductRows(
        rows: Record<string, any>[]
    ): ProductImportDTO[] {

        const products = new Map<string, ProductImportDTO>();

        for (const row of rows) {

            const productName =
                String(row.particulars || "").trim();

            if (!productName)
                continue;

            const openingQty =
                this.toNumber(row.openingBalanceQuantity);

            const openingRate =
                this.toNumber(row.openingBalanceRate);

            if (openingQty <= 0 && openingRate <= 0)
                continue;

            products.set(productName.toUpperCase(), {

                productName,

                openingStockKG: openingQty,

                sellPrice: openingRate,

                density: 1

            });

        }

        return [...products.values()];
    }

    static parseJournalRows(
        rows: Record<string, any>[]
    ): JournalImportDTO[] {

        return rows

            .map(row => {

                const voucherType =
                    String(
                        this.getValue(
                            row,
                            "Vch Type",
                            "Voucher Type"
                        ) || ""
                    ).trim();

                // Skip Purchase & Tax Invoice

                const voucherNo =
                    String(
                        this.getValue(
                            row,
                            "Vch No",
                            "Voucher No"
                        ) || ""
                    ).trim();

                if (!voucherNo)
                    return null;

                return {

                    date:
                        this.toDate(
                            this.getValue(
                                row,
                                "Date"
                            )
                        ),

                    voucherNo,

                    voucherType,

                    particulars:
                        String(
                            this.getValue(
                                row,
                                "Particulars"
                            ) || ""
                        ).trim(),

                    debitAmount:
                        this.toNumber(
                            this.getValue(
                                row,
                                "Debit Amount",
                                "Debit"
                            )
                        ),

                    creditAmount:
                        this.toNumber(
                            this.getValue(
                                row,
                                "Credit Amount",
                                "Credit"
                            )
                        ),

                    raw: row

                };

            })

            .filter(Boolean);

    }
}