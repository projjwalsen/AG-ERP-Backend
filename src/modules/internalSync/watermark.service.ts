import { prisma } from "../../config/db";
import { SYNC_ENTITY_NAMES, type SyncEntityName } from "./entity.registry";

const EPOCH = new Date("1970-01-01T00:00:00.000Z");

export type WatermarkCursor = {
  lastSyncAt: Date;
  lastCursor: string | null;
};

export class WatermarkService {
  /**
   * Ensures one SyncWatermark row exists per sync entity.
   * Safe to run repeatedly (idempotent upsert).
   */
  static async ensureAllWatermarks(): Promise<number> {
    let createdOrTouched = 0;

    for (const entity of SYNC_ENTITY_NAMES) {
      await prisma.syncWatermark.upsert({
        where: { entity },
        create: {
          entity,
          lastSyncAt: EPOCH,
          lastCursor: null,
        },
        update: {},
      });
      createdOrTouched += 1;
    }

    return createdOrTouched;
  }

  static async get(entity: SyncEntityName): Promise<WatermarkCursor> {
    const row = await prisma.syncWatermark.findUnique({
      where: { entity },
    });

    if (!row) {
      // Lazy create if seed was skipped.
      const created = await prisma.syncWatermark.create({
        data: {
          entity,
          lastSyncAt: EPOCH,
          lastCursor: null,
        },
      });

      return {
        lastSyncAt: created.lastSyncAt,
        lastCursor: created.lastCursor,
      };
    }

    return {
      lastSyncAt: row.lastSyncAt,
      lastCursor: row.lastCursor,
    };
  }

  /**
   * Silent ACK:
   * - Advances watermark only when the new cursor is strictly ahead
   * - Returns minimal { ok: true }
   * - Never records job success/failure from Srv2
   */
  static async acknowledge(
    entity: SyncEntityName,
    cursor: { updatedAt: string; id: string },
  ): Promise<{ ok: true; advanced: boolean }> {
    const nextAt = new Date(cursor.updatedAt);

    if (Number.isNaN(nextAt.getTime())) {
      throw new Error(`Invalid ack cursor updatedAt: ${cursor.updatedAt}`);
    }

    if (!cursor.id) {
      throw new Error("Ack cursor id is required");
    }

    const current = await this.get(entity);

    const isAhead =
      nextAt.getTime() > current.lastSyncAt.getTime() ||
      (nextAt.getTime() === current.lastSyncAt.getTime() &&
        cursor.id > (current.lastCursor ?? ""));

    if (!isAhead) {
      // Idempotent / out-of-order ACK — stay silent, do not move backward.
      return { ok: true, advanced: false };
    }

    await prisma.syncWatermark.upsert({
      where: { entity },
      create: {
        entity,
        lastSyncAt: nextAt,
        lastCursor: cursor.id,
      },
      update: {
        lastSyncAt: nextAt,
        lastCursor: cursor.id,
      },
    });

    return { ok: true, advanced: true };
  }
}
