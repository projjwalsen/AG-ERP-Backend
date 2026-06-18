import { LedgerNature } from "@prisma/client";
import { INDIA_STATE_CODES } from "../../constants/constants"
import { ApiError } from "../middleware/errorHandler";

export const getGSTStateCode = (stateName?: string): string | null => {
    if(!stateName) return null;

    return (
        INDIA_STATE_CODES[stateName.trim().toUpperCase()] || null
    )
};

export const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

export const isValidIndianPincode = (
    pinCode?: string
) => {

    if (!pinCode) return true;

    return PINCODE_REGEX.test(
        pinCode.trim()
    );
};

export function resolveBalanceType(balance: number, nature: LedgerNature): "DR" | "CR" {
    const isNormal = balance >= 0;
    if (nature === LedgerNature.DEBIT)  return isNormal ? "DR" : "CR";
    if (nature === LedgerNature.CREDIT) return isNormal ? "CR" : "DR";
    return "DR";
}

export function parseDate(value: string, field: string): Date {
    const d = new Date(value);
    if (isNaN(d.getTime())) throw new ApiError(`Invalid ${field}: "${value}"`, 400);
    return d;
}