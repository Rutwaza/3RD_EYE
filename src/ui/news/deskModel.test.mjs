import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alertsFor,
  countdown,
  defaultDeskPrefs,
  normalizeDeskPrefs,
  pulseOf,
  selectStories,
  watchMatches,
} from './deskModel.js';
import { createDeskStore } from './deskStore.js';

const NOW = Date.UTC(2026, 10, 25, 12);
const story = (id, extra = {}) => ({
  id,
  title: `Story ${id}`,
  summary: '',
  source: 'A',
  sources: [{ name: 'A' }],
  outlets: 1,
  publishedAt: NOW - 3_600_000,
  category: 'conflict',
  priority: 70,
  level: 'high',
  africa: false,
  eastAfrica: false,
  countries: [],
  ...extra,
});

test('region, window, floor, mute and corroboration all narrow the feed', () => {
  const rows = [
    story('a', { africa: true, eastAfrica: true }),
    story('b', { africa: true, publishedAt: NOW - 40 * 3_600_000 }),
    story('c', { priority: 20, sources: [{ name: 'B' }] }),
    story('d', { outlets: 3, category: 'entertainment' }),
  ];
  const pick = (patch) =>
    selectStories(rows, { ...defaultDeskPrefs(), ...patch }, { now: NOW }).map(({ id }) => id);
  assert.deepEqual(pick({}), ['a', 'c'], 'celebrity news starts hidden');
  assert.deepEqual(pick({ region: 'east-africa' }), ['a']);
  assert.deepEqual(pick({ region: 'africa', windowHours: 120 }), ['a', 'b']);
  assert.deepEqual(pick({ floor: 50 }), ['a']);
  assert.deepEqual(pick({ mutedSources: ['B'] }), ['a']);
  assert.deepEqual(pick({ hidden: [], corroborated: true }), ['d']);
});

test('untrusted saved preferences fall back field by field', () => {
  const prefs = normalizeDeskPrefs({
    region: 'mars',
    floor: 900,
    hidden: ['economy', 'nonsense'],
    watchlist: ['Kigali', 4],
    alerts: 'yes',
  });
  assert.equal(prefs.region, 'world');
  assert.equal(prefs.floor, 90);
  assert.deepEqual(prefs.hidden, ['economy']);
  assert.deepEqual(prefs.watchlist, ['Kigali']);
  assert.equal(prefs.alerts, true);
});

test('the watchlist matches whole words only', () => {
  assert.deepEqual(watchMatches(story('a', { title: 'M23 in Goma' }), ['m23', 'Gom']), ['m23']);
});

test('alerts fire for new critical or watched stories and respect the switch', () => {
  const prefs = { ...defaultDeskPrefs(), watchlist: ['Kigali'] };
  const rows = [
    story('seen', { level: 'critical' }),
    story('new', { level: 'critical', priority: 90 }),
    story('watched', { title: 'Summit in Kigali', level: 'routine' }),
    story('plain'),
  ];
  const ids = (options) =>
    alertsFor(rows, new Set(['seen']), options, { now: NOW }).map(({ id }) => id);
  assert.deepEqual(ids(prefs), ['new', 'watched']);
  assert.deepEqual(ids({ ...prefs, alerts: false }), []);
});

test('pulse and countdown describe the present plainly', () => {
  assert.equal(pulseOf([], { now: NOW }).value, null);
  assert.equal(pulseOf([story('a', { priority: 90 })], { now: NOW }).level, 'critical');
  assert.equal(countdown({ at: NOW + 3 * 3_600_000 }, NOW), 'T-3h');
  assert.equal(countdown({ at: Date.UTC(2027, 0, 1), approximate: true }, NOW), '2027');
});

test('the store alerts only after its first read and survives an outage', async () => {
  let payload = { stories: [story('a', { level: 'critical', publishedAt: Date.now() })] };
  let fail = false;
  const store = createDeskStore({
    storage: null,
    fetchImpl: async () => ({
      ok: !fail,
      status: 503,
      json: async () => (fail ? { error: 'Down' } : payload),
    }),
  });
  const events = [];
  store.subscribe((event) => event.reason === 'news' && events.push(event));
  await store.refresh();
  assert.deepEqual(events[0].alerts, []);
  payload = { stories: [...payload.stories, story('b', { level: 'critical', publishedAt: Date.now() })] };
  await store.refresh();
  assert.deepEqual(events[1].alerts.map(({ id }) => id), ['b']);
  fail = true;
  await store.refresh();
  assert.equal(store.state.newsError, 'Down');
  assert.equal(store.state.news.stories.length, 2, 'the last good desk stays');
  store.destroy();
});
