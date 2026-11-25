import { Request } from "express";

const MAX_METADATA_BYTES = 2 * 1024;

/**
 * Best-effort client IP.
 * Prefers the first x-forwarded-for hop (set by the hosting proxy), then
 * req.ip / socket address. IPv4-mapped IPv6 prefixes are stripped.
 */
export const getClientIp = (req: Request): string | null => {
    const forwarded = req.headers["x-forwarded-for"];
    const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;

    const raw =
        (typeof forwardedValue === "string" && forwardedValue.split(",")[0].trim()) ||
        (typeof req.headers["x-real-ip"] === "string" && (req.headers["x-real-ip"] as string).trim()) ||
        req.ip ||
        req.socket?.remoteAddress ||
        "";

    if (!raw) return null;

    return raw.replace(/^::ffff:/i, "").slice(0, 64);
};

/**
 * Metadata only carries small, known values (file name, file size, counters),
 * so this just drops empty keys and enforces a size cap.
 */
export const sanitizeMetadata = (
    metadata?: Record<string, unknown> | null
): Record<string, unknown> | null => {
    if (!metadata) return null;

    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (value !== undefined && value !== null && value !== "") {
            cleaned[key] = typeof value === "string" ? value.slice(0, 500) : value;
        }
    }

    if (Object.keys(cleaned).length === 0) return null;

    if (Buffer.byteLength(JSON.stringify(cleaned), "utf8") > MAX_METADATA_BYTES) {
        return { truncated: true };
    }

    return cleaned;
};

/**
 * Copies only the allow-listed keys that exist on `source`.
 */
export const pick = (
    source: any,
    keys: string[]
): Record<string, unknown> => {
    const output: Record<string, unknown> = {};

    if (!source || typeof source !== "object" || Array.isArray(source)) {
        return output;
    }

    for (const key of keys) {
        if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
            output[key] = source[key];
        }
    }

    return output;
};
