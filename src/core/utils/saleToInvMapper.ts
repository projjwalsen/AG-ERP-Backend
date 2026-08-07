import * as converter from "number-to-words";

const DECLARATION =
    "We certified that particulars given above are true & correct & amount indicated represents the price actually charged & that there is no flow of additional consideration directly/indirectly from the buyer.";

const TERMS_AND_CONDITIONS = [
    "Interest will be charged @24% p.a from bill date for the payment delayed.",
    "Goods Dispatched by buyers risk.",
    "No Claim or Complaint in respect of material supplied vide this invoice will be entertained after the goods are delivered."
];

const formatDate = (value: any) =>
    value
        ? new Date(value).toLocaleDateString("en-IN")
        : "";

const formatMoney = (value: any) =>
    Number(value || 0).toFixed(2);

const formatAddress = (party: any) =>
    [
        party?.addressLine1,
        party?.addressLine2,
        party?.city,
        party?.state,
        party?.pinCode
    ]
        .filter(Boolean)
        .join(", ");

const derivePanFromGstin = (gstin?: string | null) =>
    gstin && gstin.length === 15
        ? gstin.slice(2, 12)
        : "";

const amountInWords = (value: any) =>
    `${converter.toWords(Number(value || 0))} only`;

export class SalesToInvMapper {

    static map(sale: any) {
        const transport = Array.isArray(sale.transport)
            ? sale.transport[0] || {}
            : sale.transport || {};

        const settings = sale.invoiceSettings || {};
        const bankAccount =
            sale.branch?.bankAccounts?.[0] || {};

        const quantityByUnit = new Map<string, number>();
        const taxMap = new Map<string, any>();

        const items = sale.items.map((item: any, index: number) => {
            const unit = String(item.unit || "");
            const quantity = Number(item.quantity || 0);

            quantityByUnit.set(
                unit,
                (quantityByUnit.get(unit) || 0) + quantity
            );

            const taxKey = [
                item.product.hsnNo || "-",
                Number(item.cgstPercent || 0),
                Number(item.sgstPercent || 0),
                Number(item.igstPercent || 0)
            ].join("|");

            if (!taxMap.has(taxKey)) {
                taxMap.set(taxKey, {
                    hsn: item.product.hsnNo || "-",
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

            const taxRow = taxMap.get(taxKey);
            taxRow.taxableValue += Number(item.taxableAmount || 0);
            taxRow.cgstAmount += Number(item.cgstAmount || 0);
            taxRow.sgstAmount += Number(item.sgstAmount || 0);
            taxRow.igstAmount += Number(item.igstAmount || 0);
            taxRow.totalTax += Number(item.gstAmount || 0);

            const notes = [
                item.product.description,
                item.batch?.batchNo
                    ? `Batch No: ${item.batch.batchNo.replace(/^Batch/i, "")}`
                    : ""
            ].filter(Boolean);

            return {
                slNo: index + 1,
                productName: item.product.name,
                notes,
                hsn: item.product.hsnNo || "",
                quantity: quantity.toFixed(2),
                unit,
                rate: formatMoney(item.sellingPrice),
                amount: formatMoney(item.taxableAmount)
            };
        });

        const quantityTotals = Array.from(
            quantityByUnit.entries()
        ).map(([unit, quantity]) => ({
            unit,
            quantity: quantity.toFixed(2),
            display: `${quantity.toFixed(2)} ${unit}`
        }));

        const totalQuantity = quantityTotals.length === 1
            ? quantityTotals[0].quantity
            : quantityTotals.map(row => row.display).join(", ");

        const totalUnit = quantityTotals.length === 1
            ? quantityTotals[0].unit
            : "";

        const outputTaxLines = [
            {
                label: "OUTPUT CGST",
                rate: Math.max(
                    0,
                    ...sale.items.map((item: any) =>
                        Number(item.cgstPercent || 0)
                    )
                ),
                amount: Number(sale.totalCGSTAmount || 0)
            },
            {
                label: "OUTPUT SGST",
                rate: Math.max(
                    0,
                    ...sale.items.map((item: any) =>
                        Number(item.sgstPercent || 0)
                    )
                ),
                amount: Number(sale.totalSGSTAmount || 0)
            },
            {
                label: "OUTPUT IGST",
                rate: Math.max(
                    0,
                    ...sale.items.map((item: any) =>
                        Number(item.igstPercent || 0)
                    )
                ),
                amount: Number(sale.totalIGSTAmount || 0)
            }
        ]
            .filter(line => line.amount !== 0)
            .map(line => ({
                ...line,
                rate: line.rate.toFixed(2),
                amount: line.amount.toFixed(2)
            }));

        const taxSummaryRows =
            Array.from(taxMap.values()).map((row: any) => ({
                hsn: row.hsn,
                taxableValue: formatMoney(row.taxableValue),
                cgstRate: formatMoney(row.cgstRate),
                cgstAmount: formatMoney(row.cgstAmount),
                sgstRate: formatMoney(row.sgstRate),
                sgstAmount: formatMoney(row.sgstAmount),
                igstRate: formatMoney(row.igstRate),
                igstAmount: formatMoney(row.igstAmount),
                totalTax: formatMoney(row.totalTax)
            }));

        const hasIGST =
            Number(sale.totalIGSTAmount || 0) !== 0;

        const sellerGSTIN =
            sale.branch?.gstin || "27AAKCA0034H1Z0";

        return {
            irn: sale.irn || "",
            ackNo: sale.ackNo || "",
            ackDate: formatDate(sale.ackDate),
            qrCodeImage: sale.qrCodeImage || "",

            sellerLogo: settings.sellerLogo || "",
            sellerName: "A G Ashtavinayaka Petrochem Pvt Ltd",
            sellerCompanyName: "A G Ashtavinayaka Petrochem Pvt Ltd",
            sellerAddress: `SURVEY NO - 222, VILLAGE - HEDAVALI, TI - SUDHAGAD, KHOPOLI - PALI ROAD, KHOPOLI, DIST - RAIGAD`,
            sellerGSTIN,
            sellerStateName: sale.branch?.state || "Maharashtra",
            sellerCIN: settings.sellerCIN || "",
            sellerEmail:
                sale.branch?.email ||
                "info@ashtvinayakapetrochem.com",

            invoiceNo: sale.invoiceNo,
            invoiceDate: formatDate(sale.invoiceDate),
            deliveryNote: transport.deliveryNote || "",
            modeOfPayment: sale.modeOfPayment || "",
            referenceNo: sale.referenceNo || "",
            referenceDate: formatDate(sale.referenceDate),
            otherReference: sale.otherReference || "",
            buyerOrderNo: transport.buyerOrderNo || "",
            buyerOrderDate: formatDate(transport.buyerOrderDate),
            despatchDocNo: transport.despatchDocNo || "",
            despatchDocDate: formatDate(transport.despatchDocDate),
            despatchThrough: transport.despatchThrough || "",
            destination: transport.destination || "",
            termsOfDelivery: transport.termsOfDelivery || "",
            billOfLadingNo: transport.billOfLadingNo || "",
            motorVehicleNo: transport.vehicleOrFlightNo || "",

            consigneeName: sale.branch?.name || "",
            consigneeAddress: formatAddress(sale.branch),
            consigneeGSTIN: sale.branch?.gstin || "",
            consigneePAN: derivePanFromGstin(sale.branch?.gstin),
            consigneeStateName: sale.branch?.state || "",
            consigneeStateCode: sale.branch?.stateCode || "",

            buyerName: sale.agency?.name || "",
            buyerAddress: formatAddress(sale.agency),
            buyerGSTIN: sale.agency?.gstin || "",
            buyerPAN: sale.agency?.panNo || "",
            buyerStateName: sale.agency?.state || "",
            buyerStateCode: sale.agency?.stateCode || "",

            items,
            outputTaxLines,
            roundOff: formatMoney(sale.roundOffAmount),
            showRoundOff:
                Number(sale.roundOffAmount || 0) !== 0,
            totalQuantity,
            totalUnit,
            quantityTotals,
            grandTotal: formatMoney(sale.grandTotal),
            amountInWords: amountInWords(sale.grandTotal),

            hasIGST,
            taxSummaryRows,
            taxSummaryTotal: {
                taxableValue: formatMoney(sale.subTotalAmount),
                cgstAmount: formatMoney(sale.totalCGSTAmount),
                sgstAmount: formatMoney(sale.totalSGSTAmount),
                igstAmount: formatMoney(sale.totalIGSTAmount),
                totalTax: formatMoney(sale.totalGSTAmount)
            },
            taxAmountInWords:
                amountInWords(sale.totalGSTAmount),

            declaration: DECLARATION,
            termsAndConditions: TERMS_AND_CONDITIONS,
            companyPAN:
                settings.companyPAN ||
                derivePanFromGstin(sellerGSTIN),
            bankName: bankAccount.bankName || "",
            bankAccountNo: bankAccount.accountNumber || "",
            bankBranchIFSC: [
                bankAccount.bankBranchName,
                bankAccount.ifscCode
            ].filter(Boolean).join(" & "),
            signatureImage: settings.signatureImage || "",
            jurisdictionText: settings.jurisdictionText || ""
        };
    }
}
