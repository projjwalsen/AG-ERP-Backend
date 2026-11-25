import { AccessLogStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/db";
import { logger } from "../../config/logger";
import { ApiError } from "../../core/middleware/errorHandler";
import { AccessLogEntry, AccessLogListQuery } from "./accessLog.types";
import { sanitizeMetadata } from "./accessLog.utils";

const MAX_LIMIT = 100;

const parseDateInput = (value: string, field: string, endOfDay = false): Date => {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new ApiError(`Invalid ${field}`, 400);
    }

    // Date-only input (YYYY-MM-DD) covers the whole day when used as an end bound.
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        date.setUTCHours(23, 59, 59, 999);
    }

    return date;
};

export class AccessLogService {

    /**
     * Fire-and-forget write. Never throws and never blocks the caller, so a
     * logging problem cannot break a business operation.
     */
    static record(entry: AccessLogEntry): void {
        void this.write(entry);
    }

    /**
     * Awaitable variant for flows that want to be sure the row is stored.
     * Still swallows errors (they are reported through pino).
     */
    static async write(entry: AccessLogEntry): Promise<void> {
        try {
            const metadata = sanitizeMetadata(entry.metadata);

            const create = (branchId: string | null) =>
                prisma.accessLog.create({
                    data: {
                        operation: entry.operation,
                        module: entry.module,
                        status: entry.status ?? AccessLogStatus.SUCCESS,

                        entityType: entry.entityType ?? null,
                        entityId: entry.entityId ?? null,
                        description: entry.description?.slice(0, 1000) ?? null,
                        ...(metadata && { metadata: metadata as Prisma.InputJsonValue }),

                        performedById: entry.performedById ?? null,
                        performedByName: entry.performedByName ?? null,
                        performedByEmail: entry.performedByEmail ?? null,

                        branchId,

                        ipAddress: entry.ipAddress ?? null
                    }
                });

            try {
                await create(entry.branchId ?? null);
            } catch (error: any) {
                // A stale/unknown branch id must not cost us the audit row.
                if (error?.code === "P2003" && entry.branchId) {
                    await create(null);
                    return;
                }
                throw error;
            }
        } catch (error) {
            logger.error({ err: error, module: entry.module, operation: entry.operation }, "Failed to write AccessLog");
        }
    }

    /**
     * Paginated, filterable read for the access-log screen.
     * Users that are not ALL-branch can only see logs of their own branch.
     */
    static async list(actor: any, query: AccessLogListQuery = {}) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const page = query.page && query.page > 0 ? query.page : 1;
        const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 25, MAX_LIMIT);
        const skip = (page - 1) * limit;

        const branchId = actor.branchAccessType === "ALL" ? query.branchId : actor.branchId;

        const createdAt: Prisma.DateTimeFilter = {};
        if (query.startDate) createdAt.gte = parseDateInput(query.startDate, "startDate");
        if (query.endDate) createdAt.lte = parseDateInput(query.endDate, "endDate", true);

        const where: Prisma.AccessLogWhereInput = {
            ...(branchId && { branchId }),
            ...(query.performedById && { performedById: query.performedById }),
            ...(query.module && { module: query.module.toUpperCase() }),
            ...(query.operation && { operation: query.operation }),
            ...(query.status && { status: query.status }),
            ...(query.entityType && { entityType: query.entityType }),
            ...(query.entityId && { entityId: query.entityId }),
            ...(query.ipAddress && { ipAddress: query.ipAddress }),
            ...(Object.keys(createdAt).length > 0 && { createdAt }),
            ...(query.search && {
                OR: [
                    { description: { contains: query.search, mode: "insensitive" } },
                    { performedByName: { contains: query.search, mode: "insensitive" } },
                    { performedByEmail: { contains: query.search, mode: "insensitive" } }
                ]
            })
        };

        const [rows, total] = await Promise.all([
            prisma.accessLog.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
                select: {
                    id: true,
                    operation: true,
                    module: true,
                    status: true,
                    entityType: true,
                    entityId: true,
                    description: true,
                    metadata: true,
                    performedById: true,
                    performedByName: true,
                    performedByEmail: true,
                    branchId: true,
                    ipAddress: true,
                    createdAt: true
                }
            }),
            prisma.accessLog.count({ where })
        ]);

        return {
            data: rows,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit) || 1,
                hasNextPage: page * limit < total,
                hasPreviousPage: page > 1
            }
        };
    }
}
