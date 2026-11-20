import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import {
  getEntityConfig,
  isSyncEntityName,
  type SyncEntityName,
} from "./entity.registry";
import { WatermarkService } from "./watermark.service";

export type SyncCursorDto = {
  updatedAt: string;
  id: string;
};

export type ExportPageResult = {
  entity: SyncEntityName;
  items: Array<Record<string, unknown>>;
  nextCursor: SyncCursorDto | null;
  hasMore: boolean;
  serverTime: string;
  watermark: {
    lastSyncAt: string;
    lastCursor: string | null;
  };
};

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString();
    }
  }
  throw new ApiError("Row cursor timestamp is invalid", 500);
}

function buildKeysetWhere(
  cursorField: string,
  updatedSince: Date,
  cursorId: string,
): Record<string, unknown> {
  return {
    OR: [
      { [cursorField]: { gt: updatedSince } },
      {
        AND: [
          { [cursorField]: updatedSince },
          { id: { gt: cursorId } },
        ],
      },
    ],
  };
}

export class InternalSyncService {
  /**
   * Export one keyset page for an entity.
   *
   * Cursor contract for Srv2 is always:
   *   { updatedAt: ISO string, id: string }
   * even when the physical column is createdAt / lastUpdated / assignedAt.
   */
  static async exportPage(input: {
    entity: string;
    limit?: number;
    updatedAt?: string;
    id?: string;
    scope?: string;
  }): Promise<ExportPageResult> {
    if (!isSyncEntityName(input.entity)) {
      throw new ApiError(`Unsupported sync entity: ${input.entity}`, 400);
    }

    const entity = input.entity;
    const config = getEntityConfig(entity);

    const limitRaw = input.limit ?? 200;
    const limit = Math.min(Math.max(Number(limitRaw) || 200, 1), 500);

    const watermark = await WatermarkService.get(entity);

    // Prefer explicit cursor from Srv2 job; otherwise resume from watermark.
    const updatedSince = input.updatedAt
      ? new Date(input.updatedAt)
      : watermark.lastSyncAt;

    if (Number.isNaN(updatedSince.getTime())) {
      throw new ApiError("Invalid updatedAt cursor", 400);
    }

    const cursorId =
      input.id ??
      watermark.lastCursor ??
      "";

    const scopeWhere = config.scopeWhere?.(input.scope);
    const keysetWhere = buildKeysetWhere(
      config.cursorField,
      updatedSince,
      cursorId,
    );

    const where = scopeWhere
      ? { AND: [keysetWhere, scopeWhere] }
      : keysetWhere;

    const rows = await config.findMany({
      where,
      orderBy: [
        { [config.cursorField]: "asc" },
        { id: "asc" },
      ],
      take: limit,
      ...(config.include ? { include: config.include } : {}),
    });

    const items = config.sanitize
      ? rows.map((row) => config.sanitize!(row))
      : rows;

    const last = items[items.length - 1];
    const hasMore = items.length === limit;

    let nextCursor: SyncCursorDto | null = null;
    if (last) {
      nextCursor = {
        updatedAt: toIso(last[config.cursorField]),
        id: String(last.id),
      };
    }

    return {
      entity,
      items,
      nextCursor,
      hasMore,
      serverTime: new Date().toISOString(),
      watermark: {
        lastSyncAt: watermark.lastSyncAt.toISOString(),
        lastCursor: watermark.lastCursor,
      },
    };
  }

  /**
   * Silent ACK after Srv2 successfully upserts a page.
   * Srv1 does not learn about job failures — only watermark advances.
   */
  static async acknowledge(input: {
    entity: string;
    cursor: { updatedAt: string; id: string } | null;
    acknowledged?: number;
    runId?: string;
  }): Promise<{ ok: true; advanced: boolean }> {
    if (!isSyncEntityName(input.entity)) {
      throw new ApiError(`Unsupported sync entity: ${input.entity}`, 400);
    }

    // Empty page / terminal ACK with null cursor — no-op, still silent.
    if (!input.cursor) {
      return { ok: true, advanced: false };
    }

    return WatermarkService.acknowledge(input.entity, input.cursor);
  }

  static async listWatermarks() {
    await WatermarkService.ensureAllWatermarks();

    const rows = await prisma.syncWatermark.findMany({
      orderBy: { entity: "asc" },
    });

    return rows.map((row) => ({
      entity: row.entity,
      lastSyncAt: row.lastSyncAt.toISOString(),
      lastCursor: row.lastCursor,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}
