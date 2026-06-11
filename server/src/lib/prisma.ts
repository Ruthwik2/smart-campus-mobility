import { PrismaClient } from '@prisma/client';

// Single client per process; Prisma manages its own pool.
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
