import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../middleware/error';

const REFRESH_TTL_MS = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function signAccessToken(user: { id: string; role: Role }) {
  return jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
  });
}

/** Opaque refresh token; only its SHA-256 hash is persisted. */
async function issueRefreshToken(userId: string, userAgent?: string) {
  const token = randomBytes(48).toString('base64url');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      userAgent,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return token;
}

export function publicUser(user: User) {
  const { passwordHash: _ph, ...rest } = user;
  return rest;
}

export async function registerPassenger(input: {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
}) {
  await assertUniqueIdentity(input.email, input.phone);
  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      email: input.email.toLowerCase(),
      phone: input.phone,
      passwordHash: await bcrypt.hash(input.password, 10),
      role: 'PASSENGER',
    },
  });
  return user;
}

export async function registerDriver(input: {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  licenseNumber: string;
  vehicleType: 'E_RICKSHAW' | 'AUTO' | 'CAB' | 'SHUTTLE';
  vehicleModel: string;
  vehiclePlate: string;
  capacity: number;
}) {
  await assertUniqueIdentity(input.email, input.phone);
  const dup = await prisma.driverProfile.findFirst({
    where: { OR: [{ licenseNumber: input.licenseNumber }, { vehiclePlate: input.vehiclePlate }] },
    select: { id: true },
  });
  if (dup) throw new ApiError(409, 'DRIVER_EXISTS', 'License or vehicle plate already registered');

  // User + profile created atomically; drivers start as PENDING verification.
  return prisma.user.create({
    data: {
      fullName: input.fullName,
      email: input.email.toLowerCase(),
      phone: input.phone,
      passwordHash: await bcrypt.hash(input.password, 10),
      role: 'DRIVER',
      driverProfile: {
        create: {
          licenseNumber: input.licenseNumber,
          vehicleType: input.vehicleType,
          vehicleModel: input.vehicleModel,
          vehiclePlate: input.vehiclePlate.toUpperCase(),
          capacity: input.capacity,
        },
      },
    },
    include: { driverProfile: true },
  });
}

async function assertUniqueIdentity(email: string, phone?: string) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, ...(phone ? [{ phone }] : [])] },
    select: { id: true },
  });
  if (existing) throw new ApiError(409, 'USER_EXISTS', 'An account with this email or phone already exists');
}

export async function login(email: string, password: string, userAgent?: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { driverProfile: true },
  });
  if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new ApiError(401, 'BAD_CREDENTIALS', 'Incorrect email or password');
  }
  return {
    user,
    accessToken: signAccessToken(user),
    refreshToken: await issueRefreshToken(user.id, userAgent),
  };
}

/**
 * Refresh-token rotation: each refresh consumes the presented token and
 * issues a new one. A revoked/expired/unknown token is rejected outright.
 */
export async function rotateRefreshToken(presented: string, userAgent?: string) {
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(presented) },
    include: { user: true },
  });
  if (!record || record.revokedAt || record.expiresAt < new Date() || !record.user.isActive) {
    throw new ApiError(401, 'REFRESH_INVALID', 'Session expired, please sign in again');
  }
  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  });
  return {
    user: record.user,
    accessToken: signAccessToken(record.user),
    refreshToken: await issueRefreshToken(record.user.id, userAgent),
  };
}

export async function revokeRefreshToken(presented: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(presented), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
