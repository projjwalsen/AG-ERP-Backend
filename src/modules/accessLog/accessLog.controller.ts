import { AccessLogOperation, AccessLogStatus } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { ApiError } from "../../core/middleware/errorHandler";
import { AccessLogService } from "./accessLog.service";

const asString = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined => {
    if (typeof value !== "string" || !value.trim()) return undefined;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const asEnum = <T extends Record<string, string>>(
    enumObject: T,
    value: unknown,
    field: string
): T[keyof T] | undefined => {
    const text = asString(value)?.toUpperCase();
    if (!text) return undefined;

    if (!Object.values(enumObject).includes(text)) {
        throw new ApiError(`Invalid ${field}. Allowed: ${Object.values(enumObject).join(", ")}`, 400);
    }

    return text as T[keyof T];
};

export const getAccessLogs = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const actor = (req as any).user;
        const q = req.query;

        const result = await AccessLogService.list(actor, {
            page: asNumber(q.page),
            limit: asNumber(q.limit),
            performedById: asString(q.performedById),
            module: asString(q.module),
            operation: asEnum(AccessLogOperation, q.operation, "operation"),
            status: asEnum(AccessLogStatus, q.status, "status"),
            entityType: asString(q.entityType),
            entityId: asString(q.entityId),
            ipAddress: asString(q.ipAddress),
            branchId: asString(q.branchId),
            search: asString(q.search),
            startDate: asString(q.startDate),
            endDate: asString(q.endDate)
        });

        res.status(200).json({
            success: true,
            data: result.data,
            meta: result.meta
        });
    } catch (error) {
        next(error);
    }
};
