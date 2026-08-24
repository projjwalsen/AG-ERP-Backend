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
            .replace(/\/?\s*KLR\.?/gi, "")
            .replace(/\/?\s*KL\.?/gi, "")
            .replace(/\/?\s*KGS?\.?/gi, "")
            .replace(/\/?\s*KG\.?/gi, "")
            .replace(/\/?\s*LTRS?\.?/gi, "")
            .replace(/\/?\s*LTR\.?/gi, "")
            .replace(/\/?\s*LITRES?\.?/gi, "")
            .replace(/\/?\s*MTS?\.?/gi, "")
            .replace(/\/?\s*MT\.?/gi, "")
            .replace(/\/?\s*NOS?\.?/gi, "")

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

    private static money(value: number): number {
        return Math.round(Number(value || 0) * 100) / 100;
    }

    private static isTotalRowLabel(value: any): boolean {
        const text =
            String(value || "")
                .replace(/\s+/g, " ")
                .trim()
                .toUpperCase();

        return /^(GROSS\s+TOTAL|GRAND\s+TOTAL|TOTAL)$/.test(text);
    }

    private static isTotalRow(row: Record<string, any>, particulars?: string): boolean {
        if (this.isTotalRowLabel(particulars)) {
            return true;
        }

        return Object.values(row || {}).some(value =>
            this.isTotalRowLabel(value)
        );
    }

    private static firstNonZeroAmount(values: Array<number | undefined>): number {
        for (const value of values) {
            const amount =
                this.money(
                    Number(value || 0)
                );

            if (amount !== 0) {
                return amount;
            }
        }

        return 0;
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

    /**
     * Detect the header row in Tally registers. Sales exports commonly have
     * report/title rows before the actual column headers, while purchase
     * exports may start at a different row.
     */
    static detectHeaderRow(
        worksheet: XLSX.WorkSheet,
        type: "PURCHASE" | "SALE"
    ): number {
        const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, {
            header: 1,
            defval: "",
            raw: false,
            range: 0,
        });

        const requiredHeaders = [
            "voucher no",
            "particulars",
            "quantity",
            "value"
        ];

        for (let index = 0; index < Math.min(rows.length, 50); index++) {
            const normalized = new Set(
                (rows[index] || []).map((cell: any) =>
                    this.normalizeHeader(cell)
                )
            );

            const matchedHeaders = requiredHeaders.filter(header =>
                normalized.has(header)
            ).length;

            if (matchedHeaders >= 3) {
                return index + 1;
            }
        }

        // Preserve the established layouts if the export uses unexpected
        // header labels and automatic detection cannot identify the row.
        return type === "SALE" ? 8 : 3;
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

    private static normalizePartyHeader(value: any): string {
        return String(value ?? "")
            .replace(/[–—−]/g, "-")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase()
            .replace(/\s+(?:DRS?|CR)\s*$/i, "")
            .trim();
    }

    private static isSalesPartyHeaderRow(
        row: Record<string, any>,
        nextRow: Record<string, any>
    ): boolean {
        const particulars = String(
            this.getValue(row, "Particulars") || ""
        ).trim();

        const parties = [
            this.getValue(row, "Buyer"),
            this.getValue(row, "Consignee"),
            this.getValue(row, "Supplier")
        ]
            .filter(Boolean)
            .map(value => this.normalizePartyHeader(value));

        const normalizedParticulars =
            this.normalizePartyHeader(particulars);

        const nextProduct = String(
            this.getValue(nextRow, "Particulars") || ""
        ).trim();

        const nextQuantity = this.toNumber(
            this.getValue(nextRow, "Quantity")
        );
        const nextRate = this.toNumber(
            this.getValue(nextRow, "Rate")
        );
        const nextValue = this.toNumber(
            this.getValue(nextRow, "Value")
        );

        return Boolean(
            normalizedParticulars &&
            parties.includes(normalizedParticulars) &&
            !this.getValue(nextRow, "Voucher No", "Vch No") &&
            nextProduct &&
            (nextQuantity > 0 || nextRate > 0 || nextValue > 0)
        );
    }

    private static getNarrationLineKind(row: Record<string, any>): "HIRING_CHARGE" | "SCRAP" | undefined {
        const text = String(this.getValue(row, "Narration") || "").replace(/\s+/g, " ").trim();
        if (/\bHIRING\s+CHARGES?\b/i.test(text) || /\b(?:STORAGE|WAREHOUSE)\s+(?:&\s*)?(?:WAREHOUSE\s+)?RENT\b/i.test(text)) return "HIRING_CHARGE";
        if (/\b(?:SCRAP|WASTE|WASTAGE)\b/i.test(text)) return "SCRAP";
        return undefined;
    }

    private static extractNarrationItem(row: Record<string, any>) {
        const narration = String(this.getValue(row, "Narration") || "").replace(/\s+/g, " ").trim();
        const kind = this.getNarrationLineKind(row);
        if (!kind) return undefined;
        const accountingProduct = Object.keys(row).find(key =>
            /\b(?:SCRAP|WASTE|WASTAGE|HIRING|STORAGE|RENT)\b/i.test(key) &&
            this.toNumber(row[key]) !== 0
        );
        const quantityMatch = narration.match(/\b(?:QTY|QNTY|QUANTITY)\s*[:=-]?\s*([\d,.]+)\s*(MT|MTS|LTR|LITRE|LITRES|KG|KGS|NOS|NO\.?S?)/i)
            || narration.match(/\b([\d,.]+)\s*(MT|MTS|LTR|LITRE|LITRES|KG|KGS|NOS|NO\.?S?)(?:\s|@|$)/i);
        const tallyQuantityMatch = narration.match(/\(\s*(NOS|NO\.?S?|KG|KGS|LTR|LITRE|LITRES)\s*([\d,.]+)\s*\*\s*([\d,.]+)/i);
        const rateMatch = narration.match(/@\s*([\d,.]+)/i);
        const quantity = quantityMatch
            ? this.toNumber(quantityMatch[1])
            : tallyQuantityMatch
                ? this.toNumber(tallyQuantityMatch[2])
                : 0;
        const unit = (quantityMatch?.[2] || tallyQuantityMatch?.[1] || "KG").toUpperCase();
        const derivedRate = rateMatch
            ? this.toNumber(rateMatch[1])
            : tallyQuantityMatch
                ? this.toNumber(tallyQuantityMatch[3])
                : 0;
        const accountingAmount = accountingProduct ? this.toNumber(row[accountingProduct]) : 0;
        if (kind === "HIRING_CHARGE") return { kind, productName: "Hiring Charges", quantity: 0, unit, rate: derivedRate, amount: accountingAmount };
        const scrapMatch = narration.match(/\b(?:SALE\s+)?((?:SCRAP|WASTE|WASTAGE)[^@()]*?)(?:\s+Q(?:TY|NTY)|\s+QUANTITY|\s+@|\s*\(|$)/i);
        const extractedProductName = (scrapMatch?.[1] || "SCRAP/WASTE")
            .replace(/^SALE\s+/i, "")
            .replace(/\s*\(\s*INTERSTATE\s+SALES?\s*\)$/i, "")
            .replace(/[,:;.-]+$/, "")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
        // Sale narrations use both "SCRAP DRUM" and "SCRAP DRUMS 1000 NOS".
        // NOS is the quantity's unit, not part of the product master name.
        const productName = /\bSCRAP\s+DRUMS?\b/i.test(extractedProductName)
            ? "SCRAP DRUM"
            : extractedProductName;
        return { kind, productName, quantity, unit, rate: derivedRate, amount: accountingAmount };
    }

    private static mergeSalesContinuationRow(
        headerRow: Record<string, any>,
        detailRow: Record<string, any>
    ): Record<string, any> {
        const inheritedRow = { ...headerRow };

        const lineFields = [
            "particulars",
            "quantity",
            "rate",
            "value",
            "input cgst 9%",
            "output cgst 9%",
            "input sgst 9%",
            "output sgst 9%",
            "input igst 18%",
            "output igst 18%",
            "input cgst",
            "output cgst",
            "input sgst",
            "output sgst",
            "input igst",
            "output igst",
            "cgst itc not reflected in gstr-2b",
            "r/off",
            "gross total",
            "grand total"
        ];

        for (const field of Object.keys(inheritedRow)) {
            if (
                lineFields.includes(field) ||
                /(cgst|sgst|igst|gst|gross total|grand total|r\/off|round)/i.test(field)
            ) {
                inheritedRow[field] = "";
            }
        }

        for (const [key, value] of Object.entries(detailRow)) {
            if (
                value !== undefined &&
                value !== null &&
                String(value).trim() !== ""
            ) {
                inheritedRow[key] = value;
            }
        }

        return inheritedRow;
    }

    static parseRows(
        rows: Record<string, any>[],
        type: "PURCHASE" | "SALE" = "PURCHASE",
        parseErrors: any[] = []
    ): ExcelRowDTO[] {

        let currentVoucherRow: Record<string, any> | undefined;

        return rows.map((row, index) => {

            const explicitVoucherNo = String(
                this.getValue(row, "Voucher No", "Vch No") || ""
            ).trim();

            const rowVoucherType = String(
                this.getValue(row, "Voucher Type", "Vch Type") || ""
            ).trim();

            const isRcmPurchase =
                type === "PURCHASE" &&
                rowVoucherType.toUpperCase().includes("RCM PURCHASE");

            if (explicitVoucherNo) {
                currentVoucherRow = row;

                if (
                    type === "SALE" &&
                    this.isSalesPartyHeaderRow(
                        row,
                        rows[index + 1] || {}
                    ) &&
                    !this.getNarrationLineKind(row)
                ) {
                    return null as any;
                }

                if (type === "PURCHASE" && !isRcmPurchase) {
                    const nextRow = rows[index + 1] || {};
                    const nextProduct = String(
                        this.getValue(nextRow, "Particulars") || ""
                    ).trim();

                    if (
                        !this.getValue(nextRow, "Voucher No") &&
                        nextProduct &&
                        (
                            this.toNumber(this.getValue(nextRow, "Quantity")) > 0 ||
                            this.toNumber(this.getValue(nextRow, "Rate")) > 0 ||
                            this.toNumber(this.getValue(nextRow, "Value")) > 0
                        )
                    ) {
                        const inheritedRow = { ...row };

                        for (const [key, value] of Object.entries(nextRow)) {
                            if (
                                value !== undefined &&
                                value !== null &&
                                String(value).trim() !== ""
                            ) {
                                inheritedRow[key] = value;
                            }
                        }

                        row = inheritedRow;
                    }
                }
            } else if (currentVoucherRow && type === "SALE") {
                const continuationProduct = String(
                    this.getValue(row, "Particulars") || ""
                ).trim();
                const continuationQuantity =
                    this.toNumber(this.getValue(row, "Quantity"));
                const continuationRate =
                    this.toNumber(this.getValue(row, "Rate"));
                const continuationValue =
                    this.toNumber(this.getValue(row, "Value"));
                const currentProduct = String(
                    this.getValue(currentVoucherRow, "Particulars") || ""
                )
                    .replace(/\s+/g, " ")
                    .trim()
                    .toUpperCase();
                const currentAgency = String(
                    this.getValue(currentVoucherRow, "Supplier", "Buyer") || ""
                )
                    .replace(/\s+/g, " ")
                    .trim()
                    .toUpperCase();
                const currentRowIsPartyHeader =
                    currentProduct &&
                    currentAgency &&
                    currentProduct === currentAgency;
                const isRepeatedItemRow =
                    !currentRowIsPartyHeader &&
                    currentProduct &&
                    currentProduct === continuationProduct
                        .replace(/\s+/g, " ")
                        .trim()
                        .toUpperCase() &&
                    this.toNumber(this.getValue(currentVoucherRow, "Quantity")) === continuationQuantity &&
                    this.toNumber(this.getValue(currentVoucherRow, "Value")) === continuationValue;

                if (
                    continuationProduct &&
                    (continuationQuantity > 0 || continuationRate > 0 || continuationValue > 0) &&
                    !isRepeatedItemRow
                ) {
                    row = this.mergeSalesContinuationRow(
                        currentVoucherRow,
                        row
                    );
                } else {
                    return null as any;
                }
            }

            const rawParticulars = String(
                this.getValue(row, "Particulars") || ""
            ).trim();
            const rowParty = this.getValue(
                row,
                "Supplier",
                "Buyer",
                "Consignee"
            );
            const isPartyLikeRow =
                Boolean(rawParticulars) &&
                this.normalizePartyHeader(rawParticulars) ===
                    this.normalizePartyHeader(rowParty);
            const narrationItem =
                type === "SALE" && (isPartyLikeRow || !rawParticulars)
                    ? this.extractNarrationItem(row)
                    : undefined;
            const particulars = narrationItem?.productName || rawParticulars;

            const voucherNo = explicitVoucherNo || String(
                this.getValue(row, "Voucher No") || ""
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
                particulars.match(/\((\d{4,8})\)/)?.[1]
                ?? particulars.match(/\b(\d{4,8})\b/)?.[1];

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
                    .trim();

            const isCancelled =
                /\bcancell?ed\b/i.test(productName) ||
                Object.values(row).some(value =>
                    /\bcancell?ed\b/i.test(String(value ?? ""))
                );

            const normalizedProduct =
                this.normalizePartyHeader(productName);

            const isTotalRow =
                this.isTotalRow(
                    row,
                    productName
                );

            if (isTotalRow) {
                return null as any;
            }

            /**
             * Ignore party/header rows in Sales Register.
             * Example:
             * Buyer == Particulars
             */
            if (
                type === "SALE" &&
                normalizedProduct &&
                agencyName &&
                normalizedProduct ===
                    this.normalizePartyHeader(agencyName) &&
                !narrationItem
            ) {
                return null as any;
            }



            /**
             * Quantity
             */
            let quantityText =
                String(
                    this.getValue(
                        row,
                        "Quantity"
                    ) || ""
                );

            let quantity =
                this.toNumber(quantityText);

            if (narrationItem?.kind === "SCRAP" && quantity <= 0) {
                quantity = narrationItem.quantity;
                quantityText = `${narrationItem.quantity} ${narrationItem.unit}`;
            }

            let value =
                this.toNumber(
                    this.getValue(
                        row,
                        "Value"
                    )
                );

            if (value <= 0 && narrationItem?.amount) {
                value = narrationItem.amount;
            }



            /**
             * Skip only completely empty rows.
             * Keep ledger/service rows because
             * they belong to the voucher.
             */
            if (
                quantity === 0 &&
                value === 0 &&
                !productName &&
                !isRcmPurchase
            ) {

                return null as any;

            }

            /**
             * Unit
             */
            let unit =
                narrationItem?.kind === "SCRAP" &&
                /^(?:NOS|NO\.?S?)$/i.test(narrationItem.unit)
                    ? "KG"
                    : narrationItem?.kind === "SCRAP"
                        ? narrationItem.unit
                        : "KG";

            if (/KLR|KL\b/i.test(quantityText)) {

                quantity *= 1000;

                unit = "LTR";

            }

            else if (/MTS?|MT/i.test(quantityText)) {

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
                !/KG|LTR|KLR|KL|MT/i.test(quantityText)
            ) {

                if (/LTR/i.test(productName))
                    unit = "LTR";

                if (/KG/i.test(productName))
                    unit = "KG";

            }

            /**
             * Rate
             */

            let rateText =
                String(
                    this.getValue(
                        row,
                        "Rate"
                    ) || ""
                );

            let rate =
                this.toNumber(rateText);

            if (rate <= 0 && narrationItem?.rate) {
                rate = narrationItem.rate;
                rateText = String(narrationItem.rate);
            }

            if (/\/(?:KLR|KL)\b/i.test(rateText)) {

                rate /= 1000;

            }

            else if (/\/MT/i.test(rateText)) {

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
                        "OUTPUT CGST",
                        "CGST ITC Not Reflected in GSTR-2B"
                    )
                );

            const sgst =
                this.toNumber(
                    this.getValue(
                        row,
                        "Input SGST 9%",
                        "Output SGST 9%",
                        "INPUT SGST",
                        "OUTPUT SGST",
                        "SGST ITC Not Reflected in GSTR-2B"
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

            const taxableAmountWithNarration =
                taxableAmount || (narrationItem?.amount || 0);

            const gstAmount =
                cgst + sgst + igst;

            const gstPercent =
                taxableAmountWithNarration > 0
                    ? Number(
                        (
                            gstAmount /
                            taxableAmountWithNarration *
                            100
                        ).toFixed(2)
                    )
                    : 0;

            console.log({
                particulars: productName,
                taxableAmount: taxableAmountWithNarration,
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

                sourceParticulars: rawParticulars,

                lineKind: narrationItem?.kind || "PRODUCT",

                hsnNo,

                quantity,

                unit,

                rate,

                taxableAmount: taxableAmountWithNarration,

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
                            "Gross Total",
                            "Grand Total"
                        )
                    ),

                isCancelled,

                isTotalRow,

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
        type: "PURCHASE" | "SALE" = "PURCHASE",
        validationErrors: any[] = []
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
                !row.agencyName &&
                !row.isCancelled
            ) {
                validationErrors.push({
                    voucherNo: row.voucherNo,
                    invoiceNo: row.invoiceNo,
                    error: `Sale voucher ${row.voucherNo} could not be imported because the agency/customer was missing.`,
                    code: "MISSING_SALE_AGENCY",
                    meta: { particulars: row.particulars, raw: row.raw }
                });
                continue;
            }

            const isRcmPurchase =
                type === "PURCHASE" &&
                row.voucherType
                    .toUpperCase()
                    .includes("RCM PURCHASE");

            /**
             * Purchase & Tax Invoice only
             */
            if (
                !isRcmPurchase &&
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

            const supplierKey =
                type === "PURCHASE"
                    ? (
                        row.agencyGSTIN?.trim().toUpperCase() ||
                        row.agencyName?.trim().toUpperCase() ||
                        ""
                    )
                    : "";

            const key =
                type === "PURCHASE"
                    ? `${row.voucherType.trim().toUpperCase()}_${supplierKey}_${row.voucherNo}_${row.invoiceNo || ""}`
                    : `${row.voucherType}_${row.voucherNo}`;

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

                    rows: [],
                    isCancelled: row.isCancelled,
                    isHiringCharge: row.lineKind === "HIRING_CHARGE",
                    isScrap: row.lineKind === "SCRAP"

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

            const isRcmPurchase =
                type === "PURCHASE" &&
                voucher.voucherType
                    .toUpperCase()
                    .includes("RCM PURCHASE");

            /**
             * RCM Purchase does NOT contain inventory items.
             *
             * Particulars may contain the supplier/party name,
             * e.g. SANJAY ROADLINES.
             *
             * That must NOT be treated as an inventory item.
             */
            const itemRows = isRcmPurchase
                ? []
                : voucher.rows.filter(row =>
                    !row.isTotalRow &&
                    row.lineKind !== "HIRING_CHARGE" &&
                    Boolean(row.particulars?.trim())
                );

            /**
             * RCM Purchase is calculated from its financial values.
             * Normal Purchase uses inventory item rows.
             */
            const financialRows = isRcmPurchase || voucher.isHiringCharge
                ? voucher.rows.filter(row =>
                    !row.isTotalRow &&
                    (
                        (row.taxableAmount || 0) !== 0 ||
                        (row.cgst || 0) !== 0 ||
                        (row.sgst || 0) !== 0 ||
                        (row.igst || 0) !== 0 ||
                        (row.grandTotal || 0) !== 0
                    )
                )
                : itemRows;

            const parsedRoundOff =
                this.firstNonZeroAmount(
                    voucher.rows.map(row => row.roundOff)
                );

            const explicitGrandTotal =
                this.firstNonZeroAmount(
                    voucher.rows.map(row => row.grandTotal)
                );

            const subTotal =
                this.money(
                    financialRows.reduce(
                        (sum, row) =>
                            sum + (row.taxableAmount || 0),
                        0
                    )
                );

            const totalCGST =
                this.money(
                    financialRows.reduce(
                        (sum, row) =>
                            sum + (row.cgst || 0),
                        0
                    )
                );

            const totalSGST =
                this.money(
                    financialRows.reduce(
                        (sum, row) =>
                            sum + (row.sgst || 0),
                        0
                    )
                );

            const totalIGST =
                this.money(
                    financialRows.reduce(
                        (sum, row) =>
                            sum + (row.igst || 0),
                        0
                    )
                );

            const totalGST =
                this.money(
                    totalCGST +
                    totalSGST +
                    totalIGST
                );

            const accountingSubTotal =
                isRcmPurchase &&
                subTotal === 0 &&
                explicitGrandTotal > 0
                    ? this.money(
                        explicitGrandTotal -
                        totalGST -
                        parsedRoundOff
                    )
                    : subTotal;

            const effectiveRoundOff =
                explicitGrandTotal
                    ? this.money(
                        explicitGrandTotal -
                        accountingSubTotal -
                        totalGST
                    )
                    : parsedRoundOff;

            const computedGrandTotal =
                this.money(
                    accountingSubTotal +
                    totalGST +
                    effectiveRoundOff
                );

            voucher.importedTotals = {

                subTotal:
                    accountingSubTotal,

                totalCGST:
                    totalCGST,

                totalSGST:
                    totalSGST,

                totalIGST:
                    totalIGST,

                totalGST:
                    totalGST,

                roundOff:
                    effectiveRoundOff,

                grandTotal:
                    explicitGrandTotal || computedGrandTotal

            };

            if (
                explicitGrandTotal &&
                Math.abs(
                    computedGrandTotal -
                    explicitGrandTotal
                ) > 0.01
            ) {
                throw new Error(
                    `Voucher ${voucher.voucherNo} total mismatch. Items ${accountingSubTotal} + GST ${totalGST} + RoundOff ${effectiveRoundOff} = ${computedGrandTotal}, but Excel Grand Total is ${explicitGrandTotal}`
                );
            }


            if (!voucher.agencyName) {

                if (type === "SALE") {
                    if (!voucher.isCancelled) {
                        validationErrors.push({
                            voucherNo: voucher.voucherNo,
                            invoiceNo: voucher.invoiceNo,
                            error: `Sale voucher ${voucher.voucherNo} could not be imported because the agency/customer was missing.`,
                            code: "MISSING_SALE_AGENCY",
                            meta: { sourceRows: voucher.rows.map(row => row.raw) }
                        });
                    }
                    continue;
                }

            }

            if (!voucher.branchName) {

                if (type === "SALE") {
                    if (!voucher.isCancelled) {
                        validationErrors.push({
                            voucherNo: voucher.voucherNo,
                            invoiceNo: voucher.invoiceNo,
                            error: `Sale voucher ${voucher.voucherNo} could not be imported because the branch was missing.`,
                            code: "MISSING_SALE_BRANCH",
                            meta: { sourceRows: voucher.rows.map(row => row.raw) }
                        });
                    }
                    continue;
                }

            }

            if (isRcmPurchase) {

                // RCM Purchase has no inventory items.
                // Financial values are handled through financialRows.

            } else if (itemRows.length === 0 && !voucher.isHiringCharge) {

                if (type === "SALE") {

                    validationErrors.push({
                        voucherNo:
                            voucher.voucherNo,

                        invoiceNo:
                            voucher.invoiceNo,

                        error:
                            `No importable item row found in Voucher ${voucher.voucherNo}. The second row has no Particulars; the voucher was skipped.`,

                        code:
                            "MISSING_SALE_PARTICULARS",
                        meta: { sourceRows: voucher.rows.map(row => row.raw), narration: voucher.narration }
                    });

                    continue;
                }

                throw new Error(
                    `No importable item rows found in Voucher ${voucher.voucherNo}. Gross Total/Grand Total rows are ignored.`
                );
            }

            for (const item of itemRows) {

                if (!item.particulars) {

                    throw new Error(
                        `Product missing in Voucher ${voucher.voucherNo}`
                    );

                }

                if (
                    item.quantity <= 0 &&
                    item.taxableAmount > 0
                ) {
                    validationErrors.push({
                        voucherNo: voucher.voucherNo,
                        invoiceNo: voucher.invoiceNo,
                        error: `Product row "${item.particulars}" has taxable value ${item.taxableAmount} but no positive quantity.`,
                        code: "INVALID_PRODUCT_QUANTITY",
                        meta: { particulars: item.particulars, narration: item.narration, raw: item.raw }
                    });
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
                this.getValue(
                    row,
                    "Agency Name",
                    "Name",
                    "Particulars"
                );


            if (!agencyName) {
                continue;
            }

            if (
                agencyName
                    .trim()
                    .toUpperCase() === "GRAND TOTAL"
            ) {
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

            const openingBalance =
                this.toNumber(
                    this.getValue(
                        row,
                        "OpeningBalance",
                        "Opening Balance",
                        "Opening Balance (Dr)",
                        "Opening Balance (Cr)",
                        "Opening"
                    )
                );

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

                openingBalance,

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

            if (
                !productName ||
                this.isTotalRow(row, productName)
            )
                continue;

            const openingQty =
                this.toNumber(row.openingBalanceQuantity);

            const openingRate =
                this.toNumber(row.openingBalanceRate);

            products.set(productName.toUpperCase(), {

                productName,

                openingStockKG:
                    openingQty > 0
                        ? openingQty
                        : undefined,

                sellPrice:
                    openingRate > 0
                        ? openingRate
                        : undefined,

                density: 1

            });

        }

        return [...products.values()];
    };

    static parseJournalRows(
        rows: Record<string, any>[]
    ): JournalImportDTO[] {

        return rows

            .map((row, index) => {

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

                const invoiceNo =
                    String(
                        this.getValue(
                            row,
                            "Supplier Invoice No",
                            "Invoice No"
                        ) || ""
                    ).trim();

                const otherReferenceNo =
                    String(
                        this.getValue(
                            row,
                            "Other References",
                            "Other Reference",
                            "Reference No"
                        ) || ""
                    ).trim();

                const particulars =
                    String(
                        this.getValue(
                            row,
                            "Particulars"
                        ) || ""
                    ).trim();

                if (this.isTotalRow(row, particulars)) {
                    return null;
                }

                return {

                    importIndex:
                        index + 1,

                    date:
                        this.toDate(
                            this.getValue(
                                row,
                                "Date"
                            )
                        ),

                    voucherNo,

                    invoiceNo,

                    otherReferenceNo,

                    voucherType,

                    particulars,

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
