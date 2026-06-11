import { z } from 'zod';

const password = z
  .string()
  .min(8, 'At least 8 characters')
  .regex(/[A-Za-z]/, 'Must include a letter')
  .regex(/[0-9]/, 'Must include a number');

export const registerPassengerSchema = z.object({
  fullName: z.string().min(2).max(80),
  email: z.string().email(),
  phone: z.string().regex(/^[0-9+\-\s]{8,15}$/).optional(),
  password,
});

export const registerDriverSchema = registerPassengerSchema.extend({
  licenseNumber: z.string().min(5).max(30),
  vehicleType: z.enum(['E_RICKSHAW', 'AUTO', 'CAB', 'SHUTTLE']).default('E_RICKSHAW'),
  vehicleModel: z.string().min(2).max(60),
  vehiclePlate: z.string().min(4).max(15),
  capacity: z.coerce.number().int().min(1).max(12).default(3),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
