import pino from 'pino';
import { env } from '../config/env';

// Pretty logs are a dev nicety. `pino-pretty` is a devDependency, so it is
// absent from the production image (`npm ci --omit=dev`). Only wire the
// transport when we're in development AND the module actually resolves —
// otherwise pino throws "unable to determine transport target" at boot.
function prettyTransport() {
  if (env.NODE_ENV !== 'development') return undefined;
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } };
  } catch {
    return undefined;
  }
}

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: prettyTransport(),
});
