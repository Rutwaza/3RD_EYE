import { fetchJson, fetchText } from './fetch.js';
import { LIVE_CHANNELS, NEWS_SOURCES, X_ACCOUNTS } from './newsSources.js';
import { analyzeNews, hotspotsFrom, trendsFrom } from './newsAnalysis.js';
import { parseFeed } from './rss.js';

const X_REFRESH_MS = 15 * 60_000;
/** Google News throttles frequent readers, so its feeds refresh less often. */
const AGGREGATED_REFRESH_MS = 8 * 60_000;

/** Google News titles end in " - Publisher"; the publisher is shown separately. */
function cleanTitle(item, source) {
  if (!source.aggregated) return item.title;
  const cut = item.title.lastIndexOf(' - ');
  const title = cut > 20 ? item.title.slice(0, cut).trim() : item.title;
  return title.replace(/\s*\|[^|]{2,40}$/, '').trim() || title;
}

function attach(item, source) {
  return {
    title: cleanTitle(item, source),
    url: item.url,
    // Google News descriptions only repeat the headline.
    summary: source.aggregated ? '' : item.summary,
    image: source.aggregated ? '' : item.image,
    publishedAt: item.publishedAt,
    sourceId: source.id,
    sourceName: source.name,
    family: source.family || source.id,
    desk: source.desk,
    trust: source.trust,
    category: source.category,
    home: source.home || null,
  };
}

/** Section fronts and "about us" pages are indexed beside real articles. */
const isArticle = (item) => item.title.split(/\s+/).length >= 4;

/** Read every publisher independently; one outage never empties the desk. */
export function createNewsReader({
  sources = NEWS_SOURCES,
  fetchTextImpl = fetchText,
  fetchJsonImpl = fetchJson,
  xToken = () => process.env.X_BEARER_TOKEN,
  now = Date.now,
} = {}) {
  const lastGood = new Map();
  const lastTry = new Map();
  let x = { at: 0, items: [], status: 'key-required', error: '' };

  async function readSource(source) {
    const held = lastGood.get(source.id);
    // A throttled feed is left alone too, or asking again keeps it throttled.
    const waiting =
      source.aggregated &&
      now() - (lastTry.get(source.id) ?? -Infinity) < AGGREGATED_REFRESH_MS;
    if (waiting && held)
      return {
        status: now() - held.at < AGGREGATED_REFRESH_MS * 2 ? 'live' : 'stale',
        items: held.items,
      };
    lastTry.set(source.id, now());
    try {
      const xml = await fetchTextImpl(source.url);
      const items = parseFeed(xml, { limit: 30 })
        .filter(isArticle)
        .map((item) => attach(item, source));
      if (!items.length) throw new Error('No articles in the feed');
      lastGood.set(source.id, { items, at: now() });
      return { status: 'live', items };
    } catch (error) {
      const previous = lastGood.get(source.id);
      return {
        status: previous ? 'stale' : 'down',
        items: previous?.items || [],
        error: error?.message || 'Unavailable',
      };
    }
  }

  async function readX() {
    const token = String(xToken() || '').trim();
    if (!token) return { status: 'key-required', items: [] };
    // Reads are billed per post, so the desk asks at most four times an hour.
    if (now() - x.at < X_REFRESH_MS) return x;
    const query = `(${X_ACCOUNTS.map((account) => `from:${account}`).join(' OR ')}) -is:reply -is:retweet`;
    const url = new URL('https://api.x.com/2/tweets/search/recent');
    url.search = new URLSearchParams({
      query,
      max_results: '30',
      'tweet.fields': 'created_at,author_id',
      expansions: 'author_id',
      'user.fields': 'username,name',
    });
    try {
      const body = await fetchJsonImpl(url.href, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const users = new Map(
        (body.includes?.users || []).map((user) => [user.id, user]),
      );
      const items = (body.data || []).map((post) => {
        const user = users.get(post.author_id);
        const text = String(post.text || '')
          .replace(/https?:\/\/\S+/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        return {
          title: text.slice(0, 220),
          url: `https://x.com/${encodeURIComponent(user?.username || 'i')}/status/${encodeURIComponent(post.id)}`,
          summary: '',
          image: '',
          publishedAt: Date.parse(post.created_at) || null,
          sourceId: 'x',
          sourceName: user ? `X · @${user.username}` : 'X',
          family: user ? `x:${user.username.toLowerCase()}` : 'x',
          desk: 'world',
          trust: 4,
          category: null,
          home: null,
        };
      });
      x = { at: now(), items, status: 'live', error: '' };
    } catch (error) {
      x = {
        ...x,
        at: now(),
        status: x.items.length ? 'stale' : 'down',
        error: error?.message || 'Unavailable',
      };
    }
    return x;
  }

  return async function readNews() {
    const [results, social] = await Promise.all([
      Promise.all(sources.map(readSource)),
      readX(),
    ]);
    const items = [
      ...results.flatMap((result) => result.items),
      ...social.items,
    ];
    if (!items.length) throw new Error('No news source answered');
    const at = now();
    const stories = analyzeNews(items, { now: at });
    const categories = {};
    for (const story of stories)
      categories[story.category] = (categories[story.category] || 0) + 1;
    return {
      stories,
      hotspots: hotspotsFrom(stories),
      trends: trendsFrom(stories, { now: at }),
      categories,
      channels: LIVE_CHANNELS,
      itemsRead: items.length,
      sources: [
        ...sources.map((source, index) => ({
          id: source.id,
          name: source.name,
          desk: source.desk,
          trust: source.trust,
          status: results[index].status,
          count: results[index].items.length,
          via: source.aggregated ? 'Google News' : 'Direct feed',
          error: results[index].error || '',
        })),
        {
          id: 'x',
          name: 'X newsrooms',
          desk: 'world',
          trust: 4,
          status: social.status,
          count: social.items.length,
          via: 'Official X API',
          error: social.error || '',
        },
      ],
    };
  };
}
