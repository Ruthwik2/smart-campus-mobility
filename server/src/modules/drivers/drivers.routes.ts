import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { storeFile } from '../../lib/storage';
import { requireAuth, requireRole } from '../../middleware/auth';
import { ApiError } from '../../middleware/error';
import { validate } from '../../middleware/validate';
import * as drivers from './drivers.service';

export const driversRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const availabilitySchema = z.object({ status: z.enum(['ONLINE', 'OFFLINE']) });
const nearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(0.2).max(50).default(5),
});
const vehiclePatchSchema = z.object({
  vehicleModel: z.string().min(2).max(60).optional(),
  capacity: z.coerce.number().int().min(1).max(12).optional(),
});

// Passengers see who is available before requesting.
driversRouter.get('/nearby', requireAuth, validate(nearbyQuery, 'query'), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof nearbyQuery>;
    res.json({ drivers: await drivers.nearbyDrivers(q.lat, q.lng, q.radiusKm) });
  } catch (e) {
    next(e);
  }
});

driversRouter.use(requireAuth, requireRole('DRIVER'));

driversRouter.patch('/me/availability', validate(availabilitySchema), async (req, res, next) => {
  try {
    const profile = await drivers.setAvailability(req.user!.id, req.body.status);
    res.json({ profile });
  } catch (e) {
    next(e);
  }
});

driversRouter.patch('/me/vehicle', validate(vehiclePatchSchema), async (req, res, next) => {
  try {
    const profile = await prisma.driverProfile.update({ where: { userId: req.user!.id }, data: req.body });
    res.json({ profile });
  } catch (e) {
    next(e);
  }
});

// Verification documents (license, RC, ID) — S3 when configured, disk otherwise.
driversRouter.post('/me/documents', upload.single('file'), async (req, res, next) => {
  try {
    const type = String(req.body.type ?? '');
    if (!['LICENSE', 'VEHICLE_RC', 'ID_PROOF'].includes(type)) {
      throw new ApiError(400, 'BAD_TYPE', 'type must be LICENSE, VEHICLE_RC or ID_PROOF');
    }
    if (!req.file) throw new ApiError(400, 'FILE_REQUIRED', 'Attach a document file');
    const profile = await prisma.driverProfile.findUnique({ where: { userId: req.user!.id } });
    if (!profile) throw new ApiError(404, 'DRIVER_NOT_FOUND', 'Driver profile not found');

    const url = await storeFile(req.file.buffer, req.file.mimetype, `documents/${profile.id}`);
    const doc = await prisma.driverDocument.create({
      data: { driverProfileId: profile.id, type, fileUrl: url },
    });
    res.status(201).json({ document: doc });
  } catch (e) {
    next(e);
  }
});

driversRouter.get('/me/dashboard', async (req, res, next) => {
  try {
    res.json(await drivers.driverDashboard(req.user!.id));
  } catch (e) {
    next(e);
  }
});
