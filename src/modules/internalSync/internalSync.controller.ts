import { Request, Response, NextFunction } from "express";
import { InternalSyncService } from "./internalSync.service";

/**
 * GET /api/internal-sync
 * Query: entity, limit?, updatedAt?, id?, scope?
 */
export const exportEntityPage = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const entity = String(req.query.entity ?? "");
    const limit = req.query.limit
      ? Number(req.query.limit)
      : undefined;
    const updatedAt = req.query.updatedAt
      ? String(req.query.updatedAt)
      : undefined;
    const id = req.query.id ? String(req.query.id) : undefined;
    const scope = req.query.scope
      ? String(req.query.scope)
      : undefined;

    const page = await InternalSyncService.exportPage({
      entity,
      ...(limit !== undefined ? { limit } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(id ? { id } : {}),
      ...(scope ? { scope } : {}),
    });

    return res.status(200).json(page);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/internal-sync/ack
 * Silent watermark advance after Srv2 upsert success.
 */
export const acknowledgePage = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { entity, cursor, acknowledged, runId } = req.body ?? {};

    const result = await InternalSyncService.acknowledge({
      entity: String(entity ?? ""),
      cursor: cursor ?? null,
      ...(acknowledged !== undefined
        ? { acknowledged: Number(acknowledged) }
        : {}),
      ...(runId ? { runId: String(runId) } : {}),
    });

    // Minimal silent response — no job status channel.
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/internal-sync/watermarks
 * Ops/debug only — list current cursors.
 */
export const listWatermarks = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const watermarks = await InternalSyncService.listWatermarks();
    return res.status(200).json({
      success: true,
      data: watermarks,
    });
  } catch (error) {
    next(error);
  }
};
