import { z } from 'zod';

export const requestRideSchema = z.object({
  pickupLabel: z.string().min(2).max(80),
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  dropLabel: z.string().min(2).max(80),
  dropLat: z.number().min(-90).max(90),
  dropLng: z.number().min(-180).max(180),
  paymentMethod: z.enum(['CASH', 'UPI']).optional(),
  scheduledFor: z.coerce.date().optional(),
}).refine((v) => v.pickupLabel !== v.dropLabel, {
  message: 'Pickup and destination must be different',
  path: ['dropLabel'],
});

export const startRideSchema = z.object({ otp: z.string().length(4) });
export const cancelRideSchema = z.object({ reason: z.string().max(200).optional() });
export const listRidesQuery = z.object({
  status: z.enum(['SCHEDULED', 'REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED']).optional(),
});
