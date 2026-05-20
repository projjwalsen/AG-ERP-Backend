import { INDIA_STATE_CODES } from "../../constants/constants"

export const getGSTStateCode = (stateName?: string): string | null => {
    if(!stateName) return null;

    return (
        INDIA_STATE_CODES[stateName.trim().toUpperCase()] || null
    )
};