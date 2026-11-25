/** Pure World Desk policy: filtering, sorting and preferences. No DOM. */

export const DESK_PREFS_KEY = 'third-eye:desk:v1';
export const REGIONS = Object.freeze([
  ['world', 'WORLD'],
  ['africa', 'AFRICA'],
  ['east-africa', 'EAST AFRICA'],
]);
export const WINDOWS = Object.freeze([
  [1, '1H'],
  [6, '6H'],
  [24, '24H'],
  [120, 'ALL'],
]);
export const SORTS = Object.freeze([
  ['priority', 'PRIORITY'],
  ['latest', 'LATEST'],
  ['outlets', 'OUTLETS'],
]);
export const CATEGORY_LABELS = Object.freeze({
  conflict: 'Conflict and security',
  geopolitics: 'Geopolitics',
  economy: 'Economy',
  technology: 'Technology',
  disaster: 'Disasters',
  health: 'Health',
  society: 'Society',
  entertainment: 'Celebrity and sport',
});
export const CATEGORY_IDS = Object.freeze(Object.keys(CATEGORY_LABELS));

const READ_LIMIT = 600;
const WATCH_LIMIT = 24;

export function defaultDeskPrefs() {
  return {
    region: 'world',
    windowHours: 24,
    sort: 'priority',
    floor: 0,
    // Celebrity and sport starts off; it can be switched on like any desk.
    hidden: ['entertainment'],
    mutedSources: [],
    watchlist: ['Rwanda', 'M23'],
    alerts: true,
    corroborated: false,
    hideRead: false,
    read: [],
  };
}

const strings = (value, limit, length = 60) =>
  Array.isArray(value)
    ? value
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim().slice(0, length))
        .slice(0, limit)
    : null;

/** Stored preferences are untrusted; anything malformed falls back. */
export function normalizeDeskPrefs(input) {
  const prefs = defaultDeskPrefs();
  if (!input || typeof input !== 'object') return prefs;
  if (REGIONS.some(([id]) => id === input.region)) prefs.region = input.region;
  if (WINDOWS.some(([hours]) => hours === input.windowHours))
    prefs.windowHours = input.windowHours;
  if (SORTS.some(([id]) => id === input.sort)) prefs.sort = input.sort;
  if (Number.isFinite(input.floor))
    prefs.floor = Math.max(0, Math.min(90, input.floor));
  const hidden = strings(input.hidden, 8);
  if (hidden) prefs.hidden = hidden.filter((id) => CATEGORY_IDS.includes(id));
  prefs.mutedSources = strings(input.mutedSources, 60) || [];
  prefs.watchlist =
    strings(input.watchlist, WATCH_LIMIT, 40) || prefs.watchlist;
  prefs.read = (strings(input.read, READ_LIMIT) || []).slice(-READ_LIMIT);
  for (const key of ['alerts', 'corroborated', 'hideRead'])
    if (typeof input[key] === 'boolean') prefs[key] = input[key];
  return prefs;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive watchlist matches for one story. */
export function watchMatches(story, watchlist) {
  const text = `${story.title} ${story.summary} ${story.countries.map(({ name }) => name).join(' ')}`;
  return watchlist.filter((term) =>
    new RegExp(
      `(?<![\\p{L}\\p{N}])${escape(term)}(?![\\p{L}\\p{N}])`,
      'iu',
    ).test(text),
  );
}

export function matchesSearch(story, query) {
  const needle = String(query || '')
    .trim()
    .toLowerCase();
  if (!needle) return true;
  const hay = [
    story.title,
    story.summary,
    story.source,
    ...story.countries.map(({ name }) => name),
    ...story.sources.map(({ name }) => name),
  ]
    .join(' ')
    .toLowerCase();
  return needle.split(/\s+/).every((part) => hay.includes(part));
}

/** Apply the reader's controls. Region counts ignore the region control. */
export function selectStories(
  stories,
  prefs,
  { search = '', now = Date.now() } = {},
) {
  const read = new Set(prefs.read);
  const muted = new Set(prefs.mutedSources);
  const hidden = new Set(prefs.hidden);
  const rows = stories.filter((story) => {
    if (prefs.region === 'africa' && !story.africa) return false;
    if (prefs.region === 'east-africa' && !story.eastAfrica) return false;
    if (hidden.has(story.category)) return false;
    if (now - story.publishedAt > prefs.windowHours * 3_600_000) return false;
    if (story.priority < prefs.floor) return false;
    if (prefs.corroborated && story.outlets < 2) return false;
    if (prefs.hideRead && read.has(story.id)) return false;
    // A muted outlet hides a story only when nobody else carries it.
    if (muted.size && story.sources.every(({ name }) => muted.has(name)))
      return false;
    return matchesSearch(story, search);
  });
  const order = {
    priority: (a, b) =>
      b.priority - a.priority || b.publishedAt - a.publishedAt,
    latest: (a, b) => b.publishedAt - a.publishedAt,
    outlets: (a, b) => b.outlets - a.outlets || b.priority - a.priority,
  };
  return rows.sort(order[prefs.sort]);
}

export function countByCategory(stories, prefs, options) {
  const counts = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0]));
  for (const story of selectStories(stories, { ...prefs, hidden: [] }, options))
    counts[story.category] += 1;
  return counts;
}

/** One number for the state of the world: the mean of the leading stories. */
export function pulseOf(stories, { now = Date.now() } = {}) {
  const leading = stories
    .filter(
      (story) =>
        story.category !== 'entertainment' &&
        now - story.publishedAt < 24 * 3_600_000,
    )
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 20);
  if (!leading.length) return { value: null, level: 'idle', bars: 0 };
  const value = Math.round(
    leading.reduce((sum, story) => sum + story.priority, 0) / leading.length,
  );
  const level =
    value >= 82
      ? 'critical'
      : value >= 70
        ? 'high'
        : value >= 55
          ? 'elevated'
          : 'calm';
  return {
    value,
    level,
    bars: Math.max(1, Math.min(5, Math.ceil(value / 20))),
  };
}

export function relativeTime(at, now = Date.now()) {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

export function countdown(event, now = Date.now()) {
  if (event.approximate) return `${new Date(event.at).getUTCFullYear()}`;
  const minutes = Math.round((event.at - now) / 60_000);
  if (minutes <= 0) return 'NOW';
  if (minutes < 60) return `T-${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `T-${hours}h` : `T-${Math.round(hours / 24)}d`;
}

/** Stories that deserve an interruption: new, and critical or watched. */
export function alertsFor(
  stories,
  knownIds,
  prefs,
  { now = Date.now(), limit = 3 } = {},
) {
  if (!prefs.alerts) return [];
  return stories
    .filter(
      (story) =>
        !knownIds.has(story.id) &&
        !prefs.hidden.includes(story.category) &&
        now - story.publishedAt < 3 * 3_600_000 &&
        (story.level === 'critical' ||
          watchMatches(story, prefs.watchlist).length > 0),
    )
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}
