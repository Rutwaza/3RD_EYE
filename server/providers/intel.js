import path from 'node:path';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { createCachedFeed } from './intel/fetch.js';
import { createNewsReader } from './intel/news.js';
import { readCalendar, readMarkets } from './intel/calendar.js';
import {
  readCrises,
  readDisplacement,
  readEconomy,
  readEnvironment,
  readOutbreaks,
  readRivers,
  readSeismic,
  readVolcanoActivity,
} from './intel/africaFeeds.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function defaultLoaders() {
  return {
    news: [90_000, createNewsReader()],
    calendar: [2 * HOUR, () => readCalendar()],
    markets: [10 * MINUTE, () => readMarkets()],
    seismic: [5 * MINUTE, () => readSeismic()],
    crises: [10 * MINUTE, () => readCrises()],
    outbreaks: [6 * HOUR, () => readOutbreaks()],
    environment: [20 * MINUTE, () => readEnvironment()],
    rivers: [6 * HOUR, () => readRivers()],
    economy: [7 * 24 * HOUR, () => readEconomy()],
    displacement: [7 * 24 * HOUR, () => readDisplacement()],
    volcanoes: [6 * HOUR, () => readVolcanoActivity()],
  };
}

/** Serve a fixed set of public feeds; callers can never choose a URL. */
export function createIntelMiddleware({
  loaders = defaultLoaders(),
  cacheDirectory = path.join(process.cwd(), '.gev-cache', 'intel'),
  allow = makeRateLimiter({ windowMs: MINUTE, max: 120, globalMax: 480 }),
} = {}) {
  const feeds = new Map(
    Object.entries(loaders).map(([name, [ttlMs, load]]) => [
      name,
      createCachedFeed({ name, ttlMs, load, cacheDirectory }),
    ]),
  );
  return async function intelMiddleware(request, response) {
    const reply = (status, payload) => {
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(JSON.stringify(payload));
    };
    if (request.method !== 'GET')
      return reply(405, { error: 'Method Not Allowed' });
    if (!allow(clientKey(request)))
      return reply(429, { error: 'Rate limit exceeded' });
    const name = new URL(
      request.url || '/',
      'http://localhost',
    ).pathname.replace(/^\/+|\/+$/g, '');
    const read = feeds.get(name);
    if (!read) return reply(404, { error: 'Unknown intelligence feed' });
    try {
      const { at, data, stale } = await read();
      return reply(200, { ...data, updatedAt: at, stale });
    } catch (error) {
      console.warn(`[Intel] ${name} unavailable:`, error?.message || error);
      return reply(503, { error: 'This source is unavailable right now' });
    }
  };
}

export function intelProxy(options) {
  const middleware = createIntelMiddleware(options);
  // Vite treats a returned function as a post-hook, so this returns nothing.
  const install = (server) => {
    server.middlewares.use('/api/intel', middleware);
  };
  return {
    name: 'third-eye-intel',
    configureServer: install,
    configurePreviewServer: install,
  };
}
