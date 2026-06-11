import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { corsOrigins } from './config/env';
import { authRouter } from './modules/auth/auth.routes';
import { usersRouter } from './modules/users/users.routes';
import { driversRouter } from './modules/drivers/drivers.routes';
import { ridesRouter } from './modules/rides/rides.routes';
import { ratingsRouter } from './modules/ratings/ratings.routes';
import { zonesRouter } from './modules/zones/zones.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { notFound, errorHandler } from './middleware/error';

export function createApp() {
  const app = express();

  // Behind nginx in production — trust the first proxy hop so req.ip,
  // secure cookies and rate-limiting see the real client.
  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Local-disk fallback for document/avatar uploads when S3 isn't configured.
  app.use('/uploads', express.static(path.resolve('uploads'), { maxAge: '1d' }));

  app.get('/api/v1/health', (_req, res) => {
    res.json({ ok: true, service: 'scm-api', time: new Date().toISOString() });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/drivers', driversRouter);
  app.use('/api/v1/rides', ridesRouter);
  app.use('/api/v1', ratingsRouter); // POST /rides/:id/rating, GET /drivers/:driverId/ratings
  app.use('/api/v1/zones', zonesRouter);
  app.use('/api/v1/admin', adminRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
