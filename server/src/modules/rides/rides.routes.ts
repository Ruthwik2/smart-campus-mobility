import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { scheduleDispatchTimeout, scheduleFutureRide } from '../../queues';
import { cancelRideSchema, listRidesQuery, requestRideSchema, startRideSchema } from './rides.schemas';
import * as rides from './rides.service';

export const ridesRouter = Router();
ridesRouter.use(requireAuth);

// Passenger requests a ride (immediate or scheduled).
ridesRouter.post('/', requireRole('PASSENGER'), validate(requestRideSchema), async (req, res, next) => {
  try {
    const ride = await rides.requestRide(req.user!.id, req.body);
    if (ride.status === 'REQUESTED') await scheduleDispatchTimeout(ride.id);
    if (ride.status === 'SCHEDULED' && ride.scheduledFor) await scheduleFutureRide(ride.id, ride.scheduledFor);
    res.status(201).json({ ride });
  } catch (e) {
    next(e);
  }
});

ridesRouter.get('/', validate(listRidesQuery, 'query'), async (req, res, next) => {
  try {
    res.json({ rides: await rides.listMyRides(req.user!, (req.query as { status?: never }).status) });
  } catch (e) {
    next(e);
  }
});

ridesRouter.get('/active', async (req, res, next) => {
  try {
    res.json({ ride: await rides.getActiveRideFor(req.user!) });
  } catch (e) {
    next(e);
  }
});

// Live dispatch board for drivers.
ridesRouter.get('/open', requireRole('DRIVER'), async (_req, res, next) => {
  try {
    res.json({ rides: await rides.listOpenRequests() });
  } catch (e) {
    next(e);
  }
});

ridesRouter.get('/:id', async (req, res, next) => {
  try {
    res.json({ ride: await rides.getRideForParticipant(req.params.id, req.user!) });
  } catch (e) {
    next(e);
  }
});

ridesRouter.post('/:id/accept', requireRole('DRIVER'), async (req, res, next) => {
  try {
    res.json({ ride: await rides.acceptRide(req.params.id, req.user!.id) });
  } catch (e) {
    next(e);
  }
});

ridesRouter.post('/:id/start', requireRole('DRIVER'), validate(startRideSchema), async (req, res, next) => {
  try {
    res.json({ ride: await rides.startRide(req.params.id, req.user!.id, req.body.otp) });
  } catch (e) {
    next(e);
  }
});

ridesRouter.post('/:id/complete', requireRole('DRIVER'), async (req, res, next) => {
  try {
    res.json({ ride: await rides.completeRide(req.params.id, req.user!.id) });
  } catch (e) {
    next(e);
  }
});

ridesRouter.post('/:id/cancel', validate(cancelRideSchema), async (req, res, next) => {
  try {
    res.json({ ride: await rides.cancelRide(req.params.id, req.user!, req.body.reason) });
  } catch (e) {
    next(e);
  }
});
