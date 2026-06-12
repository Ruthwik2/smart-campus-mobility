import http from 'node:http';
import { createApp } from './app';
import { initSockets } from './sockets';
import { initQueues } from './queues';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';

async function main() {
  const app = createApp();
  const server = http.createServer(app);

  initSockets(server);
  const closeQueues = initQueues();

  server.listen(env.PORT, '0.0.0.0', () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'scm-api listening');
});

  // Drain connections cleanly on SIGTERM/SIGINT (docker stop, ^C) so
  // in-flight rides commit and BullMQ jobs aren't half-processed.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close();
    try {
      await closeQueues();
      await prisma.$disconnect();
      redis.disconnect();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error(err, 'fatal boot error');
  process.exit(1);
});
