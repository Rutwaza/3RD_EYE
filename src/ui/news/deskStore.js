import {
  DESK_PREFS_KEY,
  alertsFor,
  defaultDeskPrefs,
  normalizeDeskPrefs,
} from './deskModel.js';

const NEWS_POLL_MS = 60_000;
/** An old copy means the server is refreshing; ask again soon. */
const CATCH_UP_MS = 12_000;
const OLD_NEWS_MS = 4 * 60_000;
const CALENDAR_POLL_MS = 15 * 60_000;
const MARKETS_POLL_MS = 5 * 60_000;

function storageOf() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/** Own the desk's data, polling and saved preferences. */
export function createDeskStore({
  fetchImpl = (...args) => globalThis.fetch(...args),
  storage = storageOf(),
  schedule = (task, ms) => setTimeout(task, ms),
  cancel = (timer) => clearTimeout(timer),
  isHidden = () => globalThis.document?.hidden === true,
} = {}) {
  let prefs = defaultDeskPrefs();
  try {
    prefs = normalizeDeskPrefs(JSON.parse(storage?.getItem(DESK_PREFS_KEY)));
  } catch {
    // Unreadable preferences start fresh.
  }
  const state = {
    news: null,
    newsError: '',
    calendar: null,
    calendarError: '',
    markets: null,
    marketsError: '',
    loading: false,
  };
  const listeners = new Set();
  const known = new Set();
  let firstLoad = true;
  let destroyed = false;
  const lifetime = new AbortController();
  const timers = new Map();

  const publish = (reason, detail = {}) => {
    for (const listener of [...listeners]) listener({ reason, ...detail });
  };

  async function read(name) {
    const response = await fetchImpl(`/api/intel/${name}`, {
      signal: lifetime.signal,
      cache: 'no-store',
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body)
      throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
  }

  async function refreshNews() {
    state.loading = true;
    publish('loading');
    try {
      const news = await read('news');
      if (destroyed) return;
      state.news = news;
      state.newsError = '';
      const alerts = firstLoad ? [] : alertsFor(news.stories, known, prefs);
      firstLoad = false;
      for (const story of news.stories) known.add(story.id);
      state.loading = false;
      publish('news', { alerts });
    } catch (error) {
      if (destroyed) return;
      state.loading = false;
      state.newsError = error?.message || 'News is unavailable';
      publish('news', { alerts: [] });
    }
  }

  const refreshInto = (key, errorKey) => async () => {
    try {
      const value = await read(key);
      if (destroyed) return;
      state[key] = value;
      state[errorKey] = '';
    } catch (error) {
      if (destroyed) return;
      state[errorKey] = error?.message || 'Unavailable';
    }
    publish(key);
  };

  function loop(name, task, ms) {
    const run = async () => {
      if (destroyed) return;
      if (!isHidden()) await task();
      if (!destroyed)
        timers.set(name, schedule(run, typeof ms === 'function' ? ms() : ms));
    };
    void run();
  }

  return Object.freeze({
    state,
    getPrefs: () => ({ ...prefs }),
    setPrefs(patch) {
      prefs = normalizeDeskPrefs({ ...prefs, ...patch });
      try {
        storage?.setItem(DESK_PREFS_KEY, JSON.stringify(prefs));
      } catch {
        // Private windows may refuse storage; the session still works.
      }
      publish('prefs');
    },
    markRead(id) {
      if (prefs.read.includes(id)) return;
      this.setPrefs({ read: [...prefs.read, id] });
    },
    start() {
      loop('news', refreshNews, () =>
        state.news && Date.now() - state.news.updatedAt > OLD_NEWS_MS
          ? CATCH_UP_MS
          : NEWS_POLL_MS,
      );
      loop(
        'calendar',
        refreshInto('calendar', 'calendarError'),
        CALENDAR_POLL_MS,
      );
      loop('markets', refreshInto('markets', 'marketsError'), MARKETS_POLL_MS);
    },
    refresh: refreshNews,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      destroyed = true;
      lifetime.abort();
      for (const timer of timers.values()) cancel(timer);
      timers.clear();
      listeners.clear();
    },
  });
}
