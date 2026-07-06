import * as XLSX from "xlsx";
import { ExcelRowDTO, GroupedVoucherDTO } from "../../core/dto/dto";
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

        for (const header of headers) {

            const value = row[this.normalizeHeader(header)];

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

        if (value === undefined || value === null)
            return 0;

        return Number(
            String(value)
                .replace(/,/g, "")
                .replace(/[^\d.-]/g, "")
        ) || 0;

    }

    private static toDate(value: any): Date | undefined {

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

        if(!sheet) {
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
        worksheet: XLSX.WorkSheet
    ): Record<string, any>[] {

        const rows =
            XLSX.utils.sheet_to_json<
                Record<string, any>
            >(worksheet, {

                defval: "",

                raw: false

            });

        return rows.map(row =>
            this.normalizeHeaders(row)
        );
    }

    static parseRows(rows: Record<string, any>[]): ExcelRowDTO[] {

        return rows.map(row => {

            const particulars =
                String(
                    this.getValue(
                        row,
                        "Particulars"
                    ) || ""
                ).trim();

            /**
             * Product Name
             */
            const productName =
                particulars
                    .replace(/\(\d+\)/g, "")
                    .replace(/\s+/g, " ")
                    .trim();

            /**
             * HSN
             */
            const hsnNo =
                particulars.match(/\((\d+)\)/)?.[1];

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

            /**
             * Unit
             */
            let unit = "KG";

            if (/MT/i.test(quantityText)) {

                quantity *= 1000;

                unit = "KG";

            }

            else if (/LTR/i.test(quantityText)) {

                unit = "LTR";

            }

            else if (/KG/i.test(quantityText)) {

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
                        row,
                        "Rate"
                    ) || ""
                );

            let rate =
                this.toNumber(rateText);

            if (/\/MT/i.test(rateText)) {

                rate /= 1000;

            }

            /**
             * GST
             */

            const cgst =
                this.toNumber(
                    this.getValue(
                        row,
                        "Input CGST 9%"
                    )
                );

            const sgst =
                this.toNumber(
                    this.getValue(
                        row,
                        "Input SGST 9%"
                    )
                );

            const igst =
                this.toNumber(
                    this.getValue(
                        row,
                        "IGST Purchase",
                        "Output IGST"
                    )
                );

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

                voucherNo:
                    String(
                        this.getValue(
                            row,
                            "Voucher No"
                        ) || ""
                    ).trim(),

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

                agencyName:
                    this.getValue(
                        row,
                        "Supplier",
                        "Buyer"
                    ),

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

                hsnNo,

                quantity,

                unit,

                rate,

                taxableAmount:
                    this.toNumber(
                        this.getValue(
                            row,
                            "Value"
                        )
                    ),

                cgst,

                sgst,

                igst,

                gstPercent:
                    cgst + sgst + igst,

                roundOff:
                    this.toNumber(
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

        });

    }

    static groupAndValidateVouchers(
        rows: ExcelRowDTO[]
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

            if (!voucher.agencyName) {

                throw new Error(
                    `Agency missing in Voucher ${voucher.voucherNo}`
                );

            }

            if (!voucher.branchName) {

                throw new Error(
                    `Branch missing in Voucher ${voucher.voucherNo}`
                );

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

                if (!item.quantity) {

                    throw new Error(
                        `Quantity missing in Voucher ${voucher.voucherNo}`
                    );

                }

                if (!item.rate) {

                    throw new Error(
                        `Rate missing in Voucher ${voucher.voucherNo}`
                    );

                }

            }

        }

        return vouchers;

    }
}