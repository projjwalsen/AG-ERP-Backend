import { AccessLogOperation, AccessLogStatus } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { ApiError } from "../../core/middleware/errorHandler";
import {
    AccessLogExportFormat,
    buildAccessLogCsv,
    buildAccessLogXlsx,
    exportFileName
} from "./accessLog.export";
import { AccessLogService } from "./accessLog.service";
import { AccessLogListQuery } from "./accessLog.types";

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

/** Filters shared by the list and the export endpoints. */
const parseFilters = (q: Request["query"]): AccessLogListQuery => ({
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

export const getAccessLogs = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const actor = (req as any).user;
        const q = req.query;

        const result = await AccessLogService.list(actor, {
            ...parseFilters(q),
            page: asNumber(q.page),
            limit: asNumber(q.limit)
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

export const exportAccessLogs = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const actor = (req as any).user;

        const formatInput = asString(req.query.format)?.toLowerCase() ?? "xlsx";
        if (formatInput !== "xlsx" && formatInput !== "csv") {
            throw new ApiError("Invalid format. Allowed: xlsx, csv", 400);
        }
        const format = formatInput as AccessLogExportFormat;

        const { rows, truncated } = await AccessLogService.listForExport(actor, parseFilters(req.query));

        const file = format === "csv"
            ? buildAccessLogCsv(rows)
            : await buildAccessLogXlsx(rows);

        res.setHeader(
            "Content-Type",
            format === "csv"
                ? "text/csv; charset=utf-8"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", `attachment; filename="${exportFileName(format)}"`);
        res.setHeader("X-Export-Truncated", truncated ? "true" : "false");
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-Export-Truncated");
        res.setHeader("Content-Length", String(file.length));

        res.status(200).end(file);
    } catch (error) {
        next(error);
    }
};
