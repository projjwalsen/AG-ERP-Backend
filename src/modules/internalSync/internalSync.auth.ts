import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { ApiError } from "../../core/middleware/errorHandler";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

/**
 * Protects /internal-sync/* with a shared machine key.
 * Not end-user JWT/cookie auth — Srv2 workers only.
 */
export function requireInternalApiKey(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const expected = process.env.INTERNAL_API_KEY;

    if (!expected) {
      throw new ApiError(
        "INTERNAL_API_KEY is not configured on Srv1",
        500,
      );
    }

    const provided = req.header("X-Internal-Api-Key");

    if (!provided || !safeEqual(provided, expected)) {
      throw new ApiError("Unauthorized internal sync request", 401);
    }

    next();
  } catch (error) {
    next(error);
  }
}
