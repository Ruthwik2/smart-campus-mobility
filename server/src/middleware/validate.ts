import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

/** Validates and replaces req.body / req.query with parsed values. */
export const validate =
  (schema: ZodTypeAny, target: 'body' | 'query' = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) return next(result.error);
    (req as unknown as Record<string, unknown>)[target] = result.data;
    next();
  };
