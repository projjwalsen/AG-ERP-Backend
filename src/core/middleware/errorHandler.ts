import { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger';

export class ApiError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = err instanceof ApiError ? err.statusCode : 500;

  const message =
    process.env.NODE_ENV === "production" && statusCode >= 500
      ? "Internal Server Error"
      : err.message || "Internal Server Error";

  if (statusCode >= 500) {
    logger.error({
      err,
      request: {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip
      },
      stack: err.stack
    });
  } else {
    logger.warn({
      err,
      request: {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip
      },
      message
    });
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack })
  });
};