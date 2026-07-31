import { ProductUnit } from "@prisma/client";
import { formatISTDateOnly } from "./loc.utils";


/* ============================================================
 * SHARED TYPES
 * ============================================================ */

type NarrationTransport = {
    vehicleOrFlightNo?: string | null;
};

type NarrationProduct = {
    name: string;
    hsnNo?: string | null;
};


/* ============================================================
 * RESOLVE TRANSPORT
 *
 * Supports both Prisma relation structures:
 *
 * transport: PurchaseTransport[]
 *
 * and
 *
 * transport: PurchaseTransport | null
 * ============================================================ */

function getVehicleNo(
    transport?:
        | NarrationTransport
        | NarrationTransport[]
        | null
): string | null {

    if (!transport) {
        return null;
    }

    const transportRecord =
        Array.isArray(transport)
            ? transport[0]
            : transport;

    const vehicleNo =
        transportRecord
            ?.vehicleOrFlightNo
            ?.trim()
            .toUpperCase();

    return vehicleNo || null;
}


/* ============================================================
 * FORMAT NUMBER
 *
 * Prevents:
 * 78.00  -> 78
 * 93.220 -> 93.22
 * ============================================================ */

function formatNumber(
    value: unknown
): string {

    const number =
        Number(value);

    if (!Number.isFinite(number)) {
        return "0";
    }

    return number.toLocaleString(
        "en-IN",
        {
            maximumFractionDigits: 3,
            useGrouping: false
        }
    );
}


/* ============================================================
 * PURCHASE NARRATION
 * ============================================================ */

export function buildPurchaseNarration(
    purchase: {

        invoiceNo: string;

        invoiceDate:
            Date | string;

        transport?:
            | NarrationTransport
            | NarrationTransport[]
            | null;

        items: {

            quantity: unknown;

            unit:
                ProductUnit;

            purchasePrice:
                unknown;

            product:
                NarrationProduct;

        }[];
    }
): string {

    const itemNarration =
        purchase.items
            .map(item => {

                const productName =
                    item.product
                        .name
                        ?.trim()
                        .toUpperCase() ||
                    "UNKNOWN PRODUCT";


                const hsn =
                    item.product.hsnNo
                        ?.trim();

                const quantity =
                    formatNumber(
                        item.quantity
                    );

                const price =
                    formatNumber(
                        item.purchasePrice
                    );


                return [
                    productName,

                    hsn
                        ? `(${hsn})`
                        : null,

                    `QTY - ${quantity} ${item.unit}`,

                    `@ ${price}/-`

                ]
                    .filter(Boolean)
                    .join(" ");
            })
            .join(", ");


    const invoiceDate =
        formatISTDateOnly(
            purchase.invoiceDate
        );


    const vehicleNo =
        getVehicleNo(
            purchase.transport
        );


    return [

        `BEING PURCHASE ${itemNarration}`,

        `AGST INVOICE NO - ${purchase.invoiceNo}`,

        `DTD - ${invoiceDate}`,

        vehicleNo
            ? `VEHICLE NO - ${vehicleNo}`
            : null

    ]
        .filter(Boolean)
        .join(" ");
}


/* ============================================================
 * SALE NARRATION
 * ============================================================ */

export function buildSaleNarration(
    sale: {

        invoiceNo: string;

        invoiceDate:
            Date | string;

        transport?:
            | NarrationTransport
            | NarrationTransport[]
            | null;

        items: {

            quantity:
                unknown;

            unit:
                ProductUnit;

            sellingPrice:
                unknown;

            product:
                NarrationProduct;

        }[];
    }
): string {

    const itemNarration =
        sale.items
            .map(item => {

                const productName =
                    item.product
                        .name
                        ?.trim()
                        .toUpperCase() ||
                    "UNKNOWN PRODUCT";


                const hsn =
                    item.product.hsnNo
                        ?.trim();

                const quantity =
                    formatNumber(
                        item.quantity
                    );

                const price =
                    formatNumber(
                        item.sellingPrice
                    );


                return [

                    productName,

                    hsn
                        ? `(${hsn})`
                        : null,

                    `QNTY ${quantity} ${item.unit}`,

                    `@${price}/-`

                ]
                    .filter(Boolean)
                    .join(" ");
            })
            .join(", ");


    const invoiceDate =
        formatISTDateOnly(
            sale.invoiceDate
        );


    const vehicleNo =
        getVehicleNo(
            sale.transport
        );


    return [

        `BEING SALE ${itemNarration}`,

        `AGST INV NO ${sale.invoiceNo}`,

        `DATE: ${invoiceDate}`,

        vehicleNo
            ? `VEHICLE NO ${vehicleNo}`
            : null

    ]
        .filter(Boolean)
        .join(" ");
}