import { AccessLogOperation, AccessLogStatus } from "@prisma/client";

/**
 * Payload accepted by AccessLogService.record().
 * Mirrors the AccessLog model in prisma/schema.prisma.
 */
export interface AccessLogEntry {
    operation: AccessLogOperation;
    module: string;
    status?: AccessLogStatus;

    entityType?: string | null;
    entityId?: string | null;
    description?: string | null;
    metadata?: Record<string, unknown> | null;

    performedById?: string | null;
    performedByName?: string | null;
    performedByEmail?: string | null;

    branchId?: string | null;

    ipAddress?: string | null;
}

/**
 * Context handed to the optional per-route hooks of auditLog().
 */
export interface AuditContext {
    req: any;
    /** Parsed JSON body sent back to the client (if any). */
    responseBody: any;
    statusCode: number;
}

/**
 * Options for the auditLog() route middleware.
 */
export interface AuditLogOptions {
    /** Business module, e.g. PURCHASE, SALE, JOURNAL, IMPORT. */
    module: string;
    operation: AccessLogOperation;
    /** Prisma-style entity name, e.g. Purchase, Sale. */
    entityType?: string;
    /** Human label used in the generated description. Defaults to entityType/module. */
    entityLabel?: string;
    /** Override the generated description. */
    describe?: (ctx: AuditContext) => string | undefined;
    /** Extra metadata merged into the sanitized metadata. */
    metadata?: (ctx: AuditContext) => Record<string, unknown> | undefined;
}

export interface AccessLogListQuery {
    page?: number;
    limit?: number;
    performedById?: string;
    module?: string;
    operation?: AccessLogOperation;
    status?: AccessLogStatus;
    entityType?: string;
    entityId?: string;
    ipAddress?: string;
    branchId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
}
