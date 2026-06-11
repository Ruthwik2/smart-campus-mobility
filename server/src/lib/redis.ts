import Redis from 'ioredis';
import { env } from '../config/env';

// General-purpose connection (GEO commands, presence, counters).
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });

// BullMQ requires maxRetriesPerRequest: null on its connections.
export const bullConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const GEO_DRIVERS_KEY = 'geo:drivers'; // GEO set of online driver positions
