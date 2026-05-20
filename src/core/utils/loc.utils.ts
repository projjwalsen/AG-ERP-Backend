import { INDIA_STATE_CODES } from "../../constants/constants"

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