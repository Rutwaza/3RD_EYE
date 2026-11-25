import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntelMiddleware } from './intel.js';
import { createCachedFeed } from './intel/fetch.js';
import { countriesInText } from './intel/gazetteer.js';
import { parseFeed, plainText, safeHttpUrl } from './intel/rss.js';
import { createNewsReader } from './intel/news.js';
import {
  analyzeNews,
  classifyStory,
  hotspotsFrom,
  trendsFrom,
} from './intel/newsAnalysis.js';
import { AFRICA_COUNTRIES, isWithinAfrica } from '../../src/data/africa.js';

const NOW = Date.UTC(2026, 10, 25, 12);
const codes = (text) => countriesInText(text).map(({ iso2 }) => iso2);
const item = (title, extra = {}) => ({
  title,
  url: `https://example.org/${encodeURIComponent(title)}${extra.sourceId || ''}`,
  summary: '',
  image: '',
  publishedAt: NOW - 3_600_000,
  sourceId: 'a',
  sourceName: 'A',
  family: extra.sourceId || 'a',
  desk: 'world',
  trust: 4,
  category: null,
  home: null,
  ...extra,
});

async function call(middleware, url, method = 'GET') {
  const response = {
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.body = JSON.parse(body);
    },
  };
  await middleware(
    { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } },
    response,
  );
  return response;
}

test('only fixed feeds are served, and a failing one reports an outage', async () => {
  const middleware = createIntelMiddleware({
    cacheDirectory: null,
    loaders: {
      good: [1_000, async () => ({ items: [1] })],
      bad: [1_000, async () => { throw new Error('secret upstream detail'); }],
    },
  });
  const good = await call(middleware, '/good');
  assert.equal(good.status, 200);
  assert.deepEqual(good.body.items, [1]);
  assert.equal((await call(middleware, '/https://evil.example')).status, 404);
  assert.equal((await call(middleware, '/good', 'POST')).status, 405);
  const bad = await call(middleware, '/bad');
  assert.equal(bad.status, 503);
  assert.doesNotMatch(bad.body.error, /secret/);
});

test('a feed keeps its last good answer through an outage', async () => {
  let time = 0;
  let fail = false;
  const read = createCachedFeed({
    name: 'x',
    ttlMs: 100,
    now: () => time,
    quickMs: 5,
    load: async () => {
      if (fail) throw new Error('down');
      return { items: ['kept'] };
    },
  });
  assert.equal((await read()).stale, false);
  fail = true;
  time = 1_000;
  const held = await read();
  assert.deepEqual(held.data.items, ['kept']);
  assert.equal(held.stale, true);
});

test('countries are read from headlines without confusing similar names', () => {
  assert.deepEqual(codes('South Sudan and Sudan sign a deal'), ['SS', 'SD']);
  assert.deepEqual(codes('M23 advances near Goma'), ['CD']);
  assert.deepEqual(codes('Equatorial Guinea votes'), ['GQ']);
  assert.deepEqual(codes('Democratic Republic of the Congo'), ['CD']);
  assert.deepEqual(codes('Thanksgiving turkey prices rise'), []);
});

test('Africa excludes southern Europe and Arabia', () => {
  assert.equal(AFRICA_COUNTRIES.length, 54);
  for (const { lat, lon, name } of AFRICA_COUNTRIES)
    assert.equal(isWithinAfrica(lat, lon), true, name);
  assert.equal(isWithinAfrica(37.09, 27.78), false);
  assert.equal(isWithinAfrica(24.7, 46.7), false);
});

test('feed text becomes plain text and unsafe links are dropped', () => {
  const [entry, ...rest] = parseFeed(
    '<rss><item><title><![CDATA[A &amp; B <b>x</b>]]></title><link>https://example.org/1</link><description>&lt;script&gt;bad()&lt;/script&gt;Hi</description><pubDate>Wed, 25 Nov 2026 10:00:00 GMT</pubDate></item><item><title>Bad</title><link>javascript:alert(1)</link></item></rss>',
  );
  assert.equal(entry.title, 'A & B x');
  assert.equal(entry.summary, 'Hi');
  assert.equal(rest.length, 0);
  assert.equal(safeHttpUrl('https://user:pass@example.org'), '');
  assert.equal(plainText('a'.repeat(400), 10).length, 10);
});

test('war outranks celebrity news, and shared coverage raises a story', () => {
  const stories = analyzeNews(
    [
      item('Rebels launch missile attack on Goma as army retreats'),
      item('Army retreats after rebels launch missile attack on Goma', { sourceId: 'b', sourceName: 'B' }),
      item('Pop singer wins Grammy for album at red carpet concert'),
    ],
    { now: NOW },
  );
  assert.equal(stories[0].category, 'conflict');
  assert.equal(stories[0].outlets, 2);
  assert.equal(stories[0].eastAfrica, true);
  assert.equal(stories.at(-1).category, 'entertainment');
  assert.ok(stories[0].priority - stories.at(-1).priority > 40);
});

test('ordinary words are not mistaken for institutions', () => {
  assert.equal(classifyStory({ title: 'The man who walked home' }), 'society');
  assert.equal(classifyStory({ title: 'WHO confirms Ebola outbreak' }), 'health');
});

test('hotspots and trends combine a country with its demonym', () => {
  const stories = analyzeNews(
    [item('Russian troops strike port'), item('Russia signs new oil treaty')],
    { now: NOW },
  );
  assert.equal(hotspotsFrom(stories)[0].iso2, 'RU');
  assert.equal(trendsFrom(stories, { now: NOW })[0].term, 'Russia');
});

test('one dead newsroom does not empty the desk, and X needs its own token', async () => {
  const sources = [
    { id: 'up', name: 'Up', url: 'https://up.example', desk: 'world', trust: 4 },
    { id: 'down', name: 'Down', url: 'https://down.example', desk: 'world', trust: 4 },
  ];
  const read = createNewsReader({
    sources,
    xToken: () => '',
    now: () => NOW,
    fetchTextImpl: async (url) => {
      if (url.includes('down')) throw new Error('HTTP 500');
      return '<item><title>Parliament passes the budget law</title><link>https://up.example/1</link></item>';
    },
    fetchJsonImpl: async () => assert.fail('X must not be called without a token'),
  });
  const news = await read();
  assert.equal(news.stories.length, 1);
  assert.deepEqual(
    news.sources.map(({ id, status }) => [id, status]),
    [['up', 'live'], ['down', 'down'], ['x', 'key-required']],
  );
});
