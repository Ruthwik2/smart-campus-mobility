import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { requireAuth, requireRole } from '../../middleware/auth';
import { ApiError } from '../../middleware/error';
import { validate } from '../../middleware/validate';

export const ratingsRouter = Router();

const rateSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

/**
 * POST /rides/:id/rating — passenger rates a completed ride.
 * Driver aggregates (avg, count) are maintained transactionally so the
 * dashboard never needs a full table scan.
 */
ratingsRouter.post('/rides/:id/rating', requireAuth, requireRole('PASSENGER'), validate(rateSchema), async (req, res, next) => {
  try {
    const ride = await prisma.ride.findUnique({ where: { id: req.params.id }, include: { rating: true } });
    if (!ride || ride.passengerId !== req.user!.id) throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride not found');
    if (ride.status !== 'COMPLETED') throw new ApiError(409, 'NOT_COMPLETED', 'Only completed rides can be rated');
    if (!ride.driverId) throw new ApiError(409, 'NO_DRIVER', 'Ride has no driver to rate');
    if (ride.rating) throw new ApiError(409, 'ALREADY_RATED', 'You already rated this ride');

    const rating = await prisma.$transaction(async (tx) => {
      const created = await tx.rating.create({
        data: {
          rideId: ride.id,
          driverId: ride.driverId!,
          passengerId: req.user!.id,
          stars: req.body.stars,
          comment: req.body.comment,
        },
      });
      const driver = await tx.driverProfile.findUniqueOrThrow({ where: { id: ride.driverId! } });
      const newCount = driver.ratingCount + 1;
      const newAvg = (driver.ratingAvg * driver.ratingCount + req.body.stars) / newCount;
      await tx.driverProfile.update({
        where: { id: driver.id },
        data: { ratingCount: newCount, ratingAvg: Number(newAvg.toFixed(2)) },
      });
      return created;
    });

    res.status(201).json({ rating });
  } catch (e) {
    next(e);
  }
});

/** Public feedback history for a driver. */
ratingsRouter.get('/drivers/:driverId/ratings', requireAuth, async (req, res, next) => {
  try {
    const ratings = await prisma.rating.findMany({
      where: { driverId: req.params.driverId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { passenger: { select: { fullName: true } } },
    });
    res.json({ ratings });
  } catch (e) {
    next(e);
  }
});
