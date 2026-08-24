
// Volume{LTR} = Mass{KG} / Density{KG/LTR}

import { ProductUnit } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/client";
import { ApiError } from "../middleware/errorHandler";

// reverse Mass{KG} = Volume{LTR} * Density{KG/LTR}
const MT_TO_KG = 1000;

/**
 * KG -> LTR
 * Formula:
 * LTR = KG / Density
 */

export const convertKGToLTR = (
    weightkg: number | Decimal, 
    density: number | Decimal
): number => {

    const kg = Number(weightkg);
    const dens = Number(density);

    if(!dens || dens <= 0) {
        throw new ApiError(
            "Density must be greater than 0",
            400
        )
    }

    return Number((kg / dens).toFixed(3));
}


/**
 * LTR -> KG
 * Formula:
 * KG = LTR * Density
 */

export const convertLTRToKG = (
    volumeLTR: number | Decimal, 
    density: number | Decimal
): number => {
    const ltr = Number(volumeLTR);
    const dens = Number(density);

    if(!dens || dens <= 0) {
        throw new ApiError(
            "Density must be greater than 0",
            400
        )
    }

    return Number((ltr * dens).toFixed(3));
}

export const convertMTToKG = (
    metricTon: number | Decimal
): number => Number((Number(metricTon) * MT_TO_KG).toFixed(3));

export const convertKGToMT = (
    weightkg: number | Decimal
): number => Number((Number(weightkg) / MT_TO_KG).toFixed(3));

export const getStockQuantities = (
    quantity: number | Decimal,
    unit: ProductUnit,
    density: number | Decimal = 1
) => {
    const normalizedQuantity = Number(quantity);
    const dens = Number(density || 1);

    if (unit === ProductUnit.MT) {
        const quantityKG = convertMTToKG(normalizedQuantity);

        return {
            quantityKG,
            quantityLTR: convertKGToLTR(quantityKG, dens)
        };
    }

    if (unit === ProductUnit.NOS) {
        return {
            // Counts use the schema's primary quantity column but never get
            // converted via a product density.
            quantityKG: normalizedQuantity,
            quantityLTR: 0
        };
    }

    if (unit === ProductUnit.KG) {
        return {
            quantityKG: normalizedQuantity,
            quantityLTR: convertKGToLTR(normalizedQuantity, dens)
        };
    }

    return {
        quantityKG: convertLTRToKG(normalizedQuantity, dens),
        quantityLTR: normalizedQuantity
    };
};

export const getAvailableQuantityForUnit = (
    availableQtyKG: number | Decimal,
    availableQtyLTR: number | Decimal,
    unit: ProductUnit
) => {
    if (unit === ProductUnit.MT) {
        return convertKGToMT(availableQtyKG);
    }

    return unit === ProductUnit.KG || unit === ProductUnit.NOS
        ? Number(availableQtyKG)
        : Number(availableQtyLTR);
};
