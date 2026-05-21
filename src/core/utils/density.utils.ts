
// Volume{LTR} = Mass{KG} / Density{KG/LTR}

import { Decimal } from "@prisma/client/runtime/client";
import { ApiError } from "../middleware/errorHandler";

// reverse Mass{KG} = Volume{LTR} * Density{KG/LTR}

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