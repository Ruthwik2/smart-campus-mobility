import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as admin from './admin.service';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN'));

adminRouter.get('/overview', async (_req, res, next) => {
  try {
    res.json(await admin.overview());
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/rides/live', async (_req, res, next) => {
  try {
    res.json({ rides: await admin.liveRides() });
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/drivers', async (req, res, next) => {
  try {
    const status = req.query.verification as string | undefined;
    const drivers = await prisma.driverProfile.findMany({
      where: status ? { verificationStatus: status as never } : {},
      include: { user: { select: { fullName: true, email: true, phone: true } }, documents: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ drivers });
  } catch (e) {
    next(e);
  }
});

const verifySchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(300).optional(),
});

adminRouter.post('/drivers/:id/verification', validate(verifySchema), async (req, res, next) => {
  try {
    res.json({ driver: await admin.setVerification(req.params.id, req.body.status, req.body.note) });
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/analytics/demand', async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days ?? 14) || 14, 90);
    res.json(await admin.demandAnalytics(days));
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/analytics/forecast', async (req, res, next) => {
  try {
    const hours = Math.min(Number(req.query.hours ?? 12) || 12, 48);
    res.json({ forecast: await admin.forecastReport(hours) });
  } catch (e) {
    next(e);
  }
});

// Manual trigger (the hourly worker also runs this).
adminRouter.post('/analytics/forecast/recompute', async (_req, res, next) => {
  try {
    const rows = await admin.recomputeForecasts(24);
    res.json({ ok: true, rows });
  } catch (e) {
    next(e);
  }
});
