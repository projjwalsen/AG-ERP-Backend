import * as converter from 'number-to-words';


export class SalesToInvMapper {

    static map(sale: any) {
        const items = sale.items.map((item: any, index: number) => ({
            slNo: index + 1,
            
            description: `
            <div class="product-name">${item.product.name}</div>

            ${item.product.description
            ? `<div class="product-description">${item.product.description}</div>`
            : ""}

            <div class="batch-no">
            Batch No: ${item.batch?.batchNo?.replace(/^Batch/i, "") || ""}
            </div>
            `.trim(),

            hsn: item.product.hsnNo,

            quantity: `${Number(item.quantity).toFixed(2)} ${item.unit}`,

            unitPrice: item.sellingPrice.toFixed(2),

            baseAmount: (Number(item.taxableAmount)).toFixed(2),

            gstRate: Number(item.product.applicableGST || 0).toFixed(2),

            rate: Number(item.sellingPrice).toFixed(2),

            amountWithGst: Number(item.totalAmount).toFixed(2)

        }));


        /**============= GST Rows =================================*/
        const cgstLines =
            Number(sale.totalCGSTAmount || 0) > 0
                ? [{
                    amount: Number(sale.totalCGSTAmount).toFixed(2)
                }]
                : [];

        const sgstLines =
            Number(sale.totalSGSTAmount || 0) > 0
                ? [{
                    amount: Number(sale.totalSGSTAmount).toFixed(2)
                }]
                : [];

        const igstLines =
            Number(sale.totalIGSTAmount || 0) > 0
                ? [{
                    amount: Number(sale.totalIGSTAmount).toFixed(2)
                }]
                : [];


        /** ================== HSN TAX SUMMARY =========================== */

        const hsnMap = new Map();

        for (const item of sale.items) {

            const hsn = item.product.hsnNo || "-";

            if (!hsnMap.has(hsn)) {
                hsnMap.set(hsn, {
                    hsn,

                    taxableValue: 0,

                    cgstRate: Number(item.cgstPercent || 0),
                    cgstAmount: 0,

                    sgstRate: Number(item.sgstPercent || 0),
                    sgstAmount: 0,

                    igstRate: Number(item.igstPercent || 0),
                    igstAmount: 0,

                    totalTax: 0
                });
            }

            const row = hsnMap.get(hsn);

            row.taxableValue += Number(item.taxableAmount || 0);

            row.cgstAmount += Number(item.cgstAmount || 0);
            row.sgstAmount += Number(item.sgstAmount || 0);
            row.igstAmount += Number(item.igstAmount || 0);

            row.totalTax += Number(item.gstAmount || 0);
        }




        /** ================== TAX Summary ===========================*/
        const taxSummaryRows = Array.from(hsnMap.values()).map((row: any) => ({
            hsn: row.hsn,

            taxableValue: row.taxableValue.toFixed(2),

            cgstRate: row.cgstRate.toFixed(2),
            cgstAmount: row.cgstAmount.toFixed(2),

            sgstRate: row.sgstRate.toFixed(2),
            sgstAmount: row.sgstAmount.toFixed(2),

            igstRate: row.igstRate.toFixed(2),
            igstAmount: row.igstAmount.toFixed(2),

            totalTax: row.totalTax.toFixed(2)
        }));


        /** =========================
         *   Final Invoice Data Object
         *  ==============================
        */
        return {
            // Seller Details
            sellerName: 'A G Ashtavinayaka Petrochem Pvt Ltd',

            sellerAddress: `
            SURVEY NO - 222, VILLAGE - HEDAVALI,
            TI - SUDHAGAD,
            KHOPOLI - PALI ROAD,
            KHOPOLI, DIST - RAIGAD
            `,

            sellerPhone: sale.branch.phnNumber || "",
            sellerGSTIN: "27AAKCA0034H1Z0",
            sellerCompanyName: "A G Ashtavinayaka Petrochem Pvt Ltd",
            sellerEmail: "info@ashtvinayakapetrochem.com",
            sellerState: "Maharashtra",

            /**
             * Invoice
            */
            invoiceNo: sale.invoiceNo,
            invoiceDate: new Date(sale.invoiceDate).toLocaleDateString("en-IN"),

            /**
             * Buyer
            */
            buyerName: sale.agency.name,
            buyerAddress: [
                sale.agency.addressLine1,
                sale.agency.addressLine2,
                sale.agency.city,
                sale.agency.state,
                sale.agency.pinCode
            ]
                .filter(Boolean)
                .join(", "),
            
            /**
             * Invoice Metadata
            */
            deliveryNote: sale.deliveryNote || "",
            suppliersRef: sale.suppliersRef || "",
            otherReference: sale.otherReference || "",
            buyerOrderNo: sale.buyerOrderNo || "",
            buyerOrderDate: sale.buyerOrderDate
                ? new Date(sale.buyerOrderDate).toLocaleDateString("en-IN")
                : "",

            despatchDocNo: sale.despatchDocNo || "",
            despatchDocDate: sale.despatchDocDate
                ? new Date(sale.despatchDocDate).toLocaleDateString("en-IN")
                : "",

            despatchThrough: sale.despatchThrough || "",
            destination: sale.destination || "",

            // Amounts
            subtotal: Number(sale.subTotalAmount).toFixed(2),
            grandTotal: Number(sale.grandTotal).toFixed(2),
            totalGSTAmount: Number(sale.totalGSTAmount).toFixed(2),

            /**
             * items
            */
           items,

           /**
            * GST Lines
           */
           cgstLines,
           sgstLines,
           igstLines,

           /**
            * Tax Summary
           */
            taxSummaryRows,

            taxSummaryTotal: {
                taxableValue: Number(sale.subTotalAmount || 0).toFixed(2),

                cgstAmount: Number(sale.totalCGSTAmount || 0).toFixed(2),

                sgstAmount: Number(sale.totalSGSTAmount || 0).toFixed(2),

                igstAmount: Number(sale.totalIGSTAmount || 0).toFixed(2),

                totalTax: Number(sale.totalGSTAmount || 0).toFixed(2)
            },

            // Amount in words
            amountInWords: converter.toWords(Number(sale.grandTotal).toFixed(2)) + " only",
            taxAmountInWords: converter.toWords(Number(sale.totalGSTAmount).toFixed(2)) + " only",

            // Signature
            signatureImage: ""

        };
    }
}