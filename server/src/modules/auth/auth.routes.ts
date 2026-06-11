import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { requireAuth } from '../../middleware/auth';
import { ApiError } from '../../middleware/error';
import { validate } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { loginSchema, registerDriverSchema, registerPassengerSchema } from './auth.schemas';
import * as auth from './auth.service';

export const authRouter = Router();

const REFRESH_COOKIE = 'scm_refresh';
const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.NODE_ENV === 'production',
  path: '/api/v1/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
};

// Brute-force protection on credential endpoints.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true });

const issueSession = (res: import('express').Response, payload: { user: unknown; accessToken: string; refreshToken: string }) => {
  res.cookie(REFRESH_COOKIE, payload.refreshToken, cookieOpts);
  return { user: payload.user, accessToken: payload.accessToken };
};

authRouter.post('/register', authLimiter, validate(registerPassengerSchema), async (req, res, next) => {
  try {
    const user = await auth.registerPassenger(req.body);
    const session = await auth.login(req.body.email, req.body.password, req.headers['user-agent']);
    res.status(201).json(issueSession(res, { ...session, user: auth.publicUser(user) }));
  } catch (e) {
    next(e);
  }
});

authRouter.post('/register/driver', authLimiter, validate(registerDriverSchema), async (req, res, next) => {
  try {
    await auth.registerDriver(req.body);
    const session = await auth.login(req.body.email, req.body.password, req.headers['user-agent']);
    res.status(201).json(issueSession(res, { ...session, user: auth.publicUser(session.user) }));
  } catch (e) {
    next(e);
  }
});

authRouter.post('/login', authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const session = await auth.login(req.body.email, req.body.password, req.headers['user-agent']);
    res.json(issueSession(res, { ...session, user: auth.publicUser(session.user) }));
  } catch (e) {
    next(e);
  }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const presented = req.cookies?.[REFRESH_COOKIE];
    if (!presented) throw new ApiError(401, 'REFRESH_MISSING', 'No session');
    const session = await auth.rotateRefreshToken(presented, req.headers['user-agent']);
    res.json(issueSession(res, { ...session, user: auth.publicUser(session.user) }));
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (presented) await auth.revokeRefreshToken(presented);
  res.clearCookie(REFRESH_COOKIE, { path: cookieOpts.path });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { driverProfile: true },
    });
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    res.json({ user: auth.publicUser(user) });
  } catch (e) {
    next(e);
  }
});
