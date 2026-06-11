import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env';
import { ApiError } from './error';

export type AccessTokenPayload = { sub: string; role: Role };

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
  return { sub: String(decoded.sub), role: decoded.role as Role };
}

/** Requires a valid Bearer access token; attaches req.user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new ApiError(401, 'UNAUTHENTICATED', 'Missing access token'));
  }
  try {
    const payload = verifyAccessToken(header.slice(7));
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    next(new ApiError(401, 'TOKEN_INVALID', 'Access token is invalid or expired'));
  }
}

/** Role gate — must run after requireAuth. */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Missing access token'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'FORBIDDEN', 'You do not have access to this resource'));
    }
    next();
  };
