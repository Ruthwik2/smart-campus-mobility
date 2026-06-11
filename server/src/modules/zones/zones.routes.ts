import { Router } from 'express';
import { prisma } from '../../lib/prisma';

export const zonesRouter = Router();

/** Public list of campus pickup/drop points used by all clients. */
zonesRouter.get('/', async (_req, res, next) => {
  try {
    const zones = await prisma.campusZone.findMany({ orderBy: { name: 'asc' } });
    res.json({ zones });
  } catch (e) {
    next(e);
  }
});
