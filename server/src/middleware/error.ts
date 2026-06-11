import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (_req: Request, res: Response) =>
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.flatten().fieldErrors },
    });
  }
  logger.error(err, 'Unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
}
