import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readCappedResponseText } from '../common/http.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; ThirdEyeConsole/2.0)';
const MAX_CONCURRENT = 5;
let active = 0;
const waiting = [];

/** Slow links time out when dozens of sockets open at once; queue instead. */
async function withSlot(task) {
  // A finishing request hands its slot straight to the next one in the queue,
  // so a newcomer can never slip in between and exceed the limit.
  if (active < MAX_CONCURRENT) active += 1;
  else await new Promise((resolve) => waiting.push(resolve));
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }
}

/** Fetch bounded text from one fixed public source. */
export function fetchText(
  url,
  { timeoutMs = 20_000, maxBytes = 4 * 1024 * 1024, headers = {} } = {},
) {
  return withSlot(async () => {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${response.status}`);
    }
    const { tooLarge, text } = await readCappedResponseText(response, maxBytes);
    if (tooLarge) throw new Error('Response is too large');
    return text;
  });
}

export async function fetchJson(url, options) {
  return JSON.parse(await fetchText(url, options));
}

/**
 * One cached feed: fresh answers come from memory, expired ones refresh, and a
 * failed refresh keeps serving the last good copy marked stale.
 */
export function createCachedFeed({
  name,
  ttlMs,
  load,
  cacheDirectory,
  quickMs = 2_500,
  now = Date.now,
}) {
  let entry = null;
  let pending = null;
  let restored = null;
  const file = cacheDirectory && path.join(cacheDirectory, `${name}.json`);

  function restore() {
    restored ||= (async () => {
      if (!file) return;
      try {
        const saved = JSON.parse(await readFile(file, 'utf8'));
        if (saved?.data && Number.isFinite(saved.at)) entry ||= saved;
      } catch {
        // No usable saved copy.
      }
    })();
    return restored;
  }

  async function refresh() {
    const data = await load();
    // A partial answer is worth showing but not worth keeping for the full TTL.
    const at = data.partial ? now() - ttlMs + Math.min(ttlMs, 300_000) : now();
    entry = { at, data };
    if (file) {
      try {
        await mkdir(cacheDirectory, { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(entry));
        await rename(temporary, file);
      } catch {
        // The saved copy is an optimisation; memory still holds the result.
      }
    }
    return entry;
  }

  return async function read() {
    await restore();
    if (entry && now() - entry.at < ttlMs) return { ...entry, stale: false };
    pending ||= refresh().finally(() => {
      pending = null;
    });
    if (!entry) return { ...(await pending), stale: false };
    // Answer at once with the last copy and let the refresh finish behind it.
    const current = entry;
    let timer;
    const quick = await Promise.race([
      pending.catch(() => null),
      new Promise((resolve) => {
        timer = setTimeout(resolve, quickMs, null);
      }),
    ]);
    clearTimeout(timer);
    return quick
      ? { ...quick, stale: false }
      : { ...current, stale: now() - current.at > ttlMs * 2 };
  };
}
