import * as converter from 'number-to-words';


export class SalesToInvMapper {

    static map(sale: any) {
        const items = sale.items.map((item: any, index: number) => ({
            slNo: index + 1,

            description:` ${item.product.name} -  ${item.product.description} `,

            hsn: item.product.hsnNo,

            quantity: `${Number(item.quantity).toFixed(2)} ${item.unit}`,

            unitPrice: item.sellingPrice.toFixed(2),

            baseAmount: (Number(item.taxableAmount)).toFixed(2),

            gstRate: Number(item.product.applicableGST || 0).toFixed(2),

            rate: Number(item.sellingPrice).toFixed(2),

            amountWithGst: Number(item.totalAmount).toFixed(2)

        }));


        /**============= GST Rows =================================*/
        const cgstLines = sale.items
            .filter((item: any) => Number(item.cgstAmount) > 0)
            .map((item: any) => ({
                // rate: `${Number(item.cgstPercent).toFixed(2)}%`,
                amount: Number(item.cgstAmount).toFixed(2)
            }));

        const sgstLines = sale.items
            .filter((item: any) => Number(item.sgstAmount) > 0)
            .map((item: any) => ({
                // rate: `${Number(item.sgstPercent).toFixed(2)}%`,
                amount: Number(item.sgstAmount).toFixed(2)
            }));

        const igstLines = sale.items
            .filter((item: any) => Number(item.igstAmount) > 0)
            .map((item: any) => ({
                // rate: `${Number(item.igstPercent).toFixed(2)}%`,
                amount: Number(item.igstAmount).toFixed(2)
            }));

        /** ================== TAX Summary ===========================*/
        const taxSummary = sale.items.map((item: any) => ({
            hsn: item.product.hsnNo || "-",
            taxableValue: Number(item.taxableAmount).toFixed(2),
            cgstRate: Number(item.cgstPercent).toFixed(2),
            cgstAmount: Number(item.cgstAmount).toFixed(2),
            sgstRate: Number(item.sgstPercent).toFixed(2),
            sgstAmount: Number(item.sgstAmount).toFixed(2),
            totalTax: Number(item.gstAmount).toFixed(2)
        }));


        /** =========================
         *   Final Invoice Data Object
         *  ==============================
        */
        return {
            // Seller Details
            sellerName: sale.branch.name,

            sellerAddress: [
                sale.branch.addressLine1,
                sale.branch.addressLine2,
                sale.branch.city,
                sale.branch.state,
                sale.branch.pinCode
            ]
                .filter(Boolean)
                .join(", "),

            sellerPhone: sale.branch.phnNumber || "",
            sellerGSTIN: sale.branch.gstin || "",
            sellerCompanyName: sale.branch.name,

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
            taxSummary,

            taxSummaryTotal: {
                taxableValue: Number(sale.subTotalAmount).toFixed(2),
                cgstAmount: Number(sale.totalCGSTAmount).toFixed(2),
                sgstAmount: Number(sale.totalSGSTAmount).toFixed(2),
                totalTax: Number(sale.totalGSTAmount).toFixed(2)
            },

            // Amount in words
            amountInWords: "Rupees Only",
            taxAmountInWords: converter.toWords(Number(sale.totalGSTAmount).toFixed(2)) + " only",

            // Signature
            signatureImage: ""

        };
    }
}