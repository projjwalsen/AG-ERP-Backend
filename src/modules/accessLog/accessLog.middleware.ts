import { AccessLogOperation, AccessLogStatus } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { prisma } from "../../config/db";
import { logger } from "../../config/logger";
import { AUTH_COOKIE_NAME } from "../../core/utils/cookie.util";
import { verifyAuthToken } from "../../core/utils/jwt.util";
import { AccessLogService } from "./accessLog.service";
import { AuditLogOptions } from "./accessLog.types";
import { getClientIp, pick } from "./accessLog.utils";

const PAST_TENSE: Record<AccessLogOperation, string> = {
    CREATE: "Created",
    UPDATE: "Updated",
    DELETE: "Deleted",
    APPROVE: "Approved",
    REJECT: "Rejected",
    IMPORT: "Imported",
    EXPORT: "Exported",
    LOGIN: "Logged in",
    LOGOUT: "Logged out"
};

/** Response fields used to name the record in the description. */
const REFERENCE_KEYS = [
    "invoiceNo",
    "voucherNo",
    "purchaseOrderNo",
    "poNo",
    "orderNo",
    "noteNo",
    "transactionNo",
    "serialNo",
    "name",
    "code"
];

/** Import summary counters taken from the SSE "completed" event. */
const IMPORT_SUMMARY_KEYS = ["total", "success", "skipped", "failed"];

const COMPLETED_EVENT = /event:\s*completed\s*\r?\ndata:\s*(.+)/;

const asString = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

const firstParamId = (params: Record<string, any> | undefined): string | undefined => {
    if (!params) return undefined;
    const key = Object.keys(params).find(name => name === "id" || /Id$/.test(name));
    return key ? asString(params[key]) : undefined;
};

interface SessionUser {
    id?: string;
    name?: string;
    email?: string;
    branchId?: string | null;
}

/**
 * Logout has no auth middleware (it must still clear a bad cookie), so the
 * only identity available is the auth cookie still on the request.
 * Returns null when the cookie is missing or no longer valid.
 */
const userFromAuthCookie = async (req: Request): Promise<SessionUser | null> => {
    try {
        const token = (req as any).cookies?.[AUTH_COOKIE_NAME];
        if (typeof token !== "string" || !token) return null;

        const tokenData = verifyAuthToken<{ userId?: string }>(token);
        if (!tokenData?.userId) return null;

        return prisma.user.findUnique({
            where: { id: tokenData.userId },
            select: { id: true, name: true, email: true, branchId: true }
        });
    } catch {
        return null;
    }
};

/**
 * Route middleware that records an AccessLog row once the response is over.
 *
 * Place it after authMiddleware/checkPermission:
 *   router.post("/create", checkPermission("X:WRITE"), auditLog({...}), controller)
 *
 * - Does not change the response or the controller.
 * - Successful actions are always logged. Failed attempts are logged only for
 *   imports; failed logins and ordinary validation errors are not stored.
 * - Detects SSE import endpoints (text/event-stream) and logs the final
 *   "completed" summary; a stream that ends without it is logged as FAILED.
 * - Metadata is kept for imports only (file name, size, counters).
 * - Never throws: logging problems are reported through pino only.
 */
export const auditLog = (options: AuditLogOptions) => {
    const isLogin = options.operation === AccessLogOperation.LOGIN;
    const isLogout = options.operation === AccessLogOperation.LOGOUT;
    const isImportModule = options.module === "IMPORT";
    // Only imports keep failed rows. Failed logins are not logged.
    const logsFailures = isImportModule;

    return (req: Request, res: Response, next: NextFunction) => {
        try {
            let responseBody: any;
            let completedPayload: any;
            let logged = false;

            const originalJson = res.json.bind(res);
            (res as any).json = (body: any) => {
                responseBody = body;
                return originalJson(body);
            };

            // SSE imports send their final summary through res.write().
            const originalWrite = (res as any).write.bind(res);
            (res as any).write = (chunk: any, ...args: any[]) => {
                try {
                    if (!completedPayload && (typeof chunk === "string" || Buffer.isBuffer(chunk))) {
                        const text = chunk.toString();
                        if (text.includes("event: completed")) {
                            const match = COMPLETED_EVENT.exec(text);
                            if (match) completedPayload = JSON.parse(match[1]);
                        }
                    }
                } catch {
                    // Sniffing must never affect the stream.
                }
                return originalWrite(chunk, ...args);
            };

            res.on("close", () => {
                if (logged) return;
                logged = true;

                void (async () => {
                    try {
                        const actor = (req as any).user;
                        const finished = res.writableFinished;
                        const streaming = /text\/event-stream/i.test(String(res.getHeader("content-type") || ""));

                        const body = streaming ? completedPayload : responseBody;
                        const data = body?.data;

                        let succeeded = res.statusCode < 400 && finished;
                        if (streaming) {
                            succeeded = succeeded && !!completedPayload && completedPayload.success !== false;
                        }

                        // Ordinary failed requests are not logged.
                        if (!succeeded && !logsFailures) return;

                        // Login returns the user under data.user and has no req.user.
                        // Logout keeps the old cookie, so the user is read from that.
                        let sessionUser: SessionUser | undefined =
                            data?.user && typeof data.user === "object" ? data.user : undefined;

                        if (isLogout && !actor?.id) {
                            sessionUser = (await userFromAuthCookie(req)) ?? undefined;
                        }

                        const ip = getClientIp(req);
                        const label = options.entityLabel ?? options.entityType ?? options.module;
                        const referenceSource = (isLogin || isLogout) ? sessionUser : data;
                        const reference = REFERENCE_KEYS
                            .map(key => asString(referenceSource?.[key]))
                            .find(Boolean);

                        const summary = streaming ? pick(data, IMPORT_SUMMARY_KEYS) : {};

                        let failureReason: string | undefined;
                        if (!succeeded) {
                            failureReason = asString(body?.message) ??
                                (streaming && !completedPayload
                                    ? "Connection closed before the import completed"
                                    : !finished
                                        ? "Request interrupted before completion"
                                        : undefined);
                        }

                        const context = { req, responseBody: body, statusCode: res.statusCode };

                        let description: string | undefined;
                        try {
                            description = options.describe?.(context);
                        } catch {
                            description = undefined;
                        }

                        if (!description) {
                            if (succeeded) {
                                if (isLogin || isLogout) {
                                    // e.g. "Logged in Rahul Sharma (rahul@ag.com) from 103.21.58.14"
                                    const who = asString(sessionUser?.name) ?? "";
                                    const email = asString(sessionUser?.email);
                                    description = [
                                        PAST_TENSE[options.operation],
                                        who,
                                        email ? `(${email})` : "",
                                        ip ? `from ${ip}` : ""
                                    ].filter(Boolean).join(" ");
                                } else {
                                    description = `${PAST_TENSE[options.operation]} ${label}${reference ? ` ${reference}` : ""}`;
                                }
                                if (streaming && Object.keys(summary).length) {
                                    const counts = IMPORT_SUMMARY_KEYS
                                        .filter(key => summary[key] !== undefined)
                                        .map(key => `${key} ${summary[key]}`)
                                        .join(", ");
                                    if (counts) description += ` (${counts})`;
                                }
                            } else {
                                description = `Failed to ${options.operation.toLowerCase()} ${label}`;
                                if (failureReason) description += `: ${failureReason}`;
                            }
                        }

                        // Metadata is kept for imports only.
                        const file = (req as any).file;
                        const metadata: Record<string, unknown> | null = isImportModule
                            ? {
                                ...(file && { fileName: file.originalname, fileSize: file.size }),
                                ...summary,
                                ...(failureReason && { error: failureReason })
                            }
                            : null;

                        AccessLogService.record({
                            operation: options.operation,
                            module: options.module,
                            status: succeeded ? AccessLogStatus.SUCCESS : AccessLogStatus.FAILED,

                            entityType: options.entityType ?? null,
                            entityId: asString(data?.id) ?? asString(sessionUser?.id) ?? firstParamId(req.params) ?? null,
                            description,
                            metadata,

                            performedById: actor?.id ?? asString(sessionUser?.id) ?? null,
                            performedByName: actor?.name ?? asString(sessionUser?.name) ?? null,
                            performedByEmail: actor?.email ?? asString(sessionUser?.email) ?? null,

                            branchId: actor?.branchId ?? asString(sessionUser?.branchId) ?? asString(data?.branchId) ?? null,

                            ipAddress: ip
                        });
                    } catch (error) {
                        logger.error({ err: error, module: options.module }, "AccessLog middleware failed");
                    }
                })();
            });
        } catch (error) {
            logger.error({ err: error, module: options.module }, "AccessLog middleware setup failed");
        }

        next();
    };
};
