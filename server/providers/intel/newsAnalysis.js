import { createHash } from 'node:crypto';
import { countriesInText, countryByCode } from './gazetteer.js';

export const NEWS_CATEGORIES = Object.freeze([
  'conflict',
  'geopolitics',
  'economy',
  'technology',
  'disaster',
  'health',
  'society',
  'entertainment',
]);

const words = (list) =>
  new RegExp(`(?<![\\p{L}])(?:${list.join('|')})(?![\\p{L}])`, 'giu');

/** Vocabulary that decides a story's desk. Each distinct term counts once. */
const CATEGORY_TERMS = {
  conflict: words([
    'wars?',
    'warfare',
    'attack(?:s|ed)?',
    'airstrikes?',
    'air strikes?',
    'drone strikes?',
    'strikes? on',
    'missiles?',
    'bomb(?:s|ing|ed|ings)?',
    'shelling',
    'troops',
    'soldiers?',
    'army',
    'military',
    'militia',
    'militants?',
    'rebels?',
    'insurgents?',
    'insurgency',
    'ceasefire',
    'cease-fire',
    'truce',
    'offensive',
    'frontline',
    'front line',
    'invasion',
    'invad(?:e|es|ed|ing)',
    'coup',
    'hostages?',
    'massacre',
    'gunmen',
    'terror(?:ist|ists|ism)?',
    'jihadists?',
    'clash(?:es)?',
    'fighting',
    'weapons?',
    'nuclear weapons?',
    'warships?',
    'fighter jets?',
    'drones?',
    'M23',
    'RSF',
    'al-Shabaa?b',
    'Boko Haram',
    'Hezbollah',
    'Hamas',
    'genocide',
    'war crimes?',
    'killed in',
    'siege',
  ]),
  geopolitics: words([
    'sanctions?',
    'diplomat(?:s|ic)?',
    'diplomacy',
    'summit',
    'treaty',
    'ambassador',
    'embassy',
    'foreign minister',
    'foreign ministry',
    'president(?:ial)?',
    'prime minister',
    'parliament',
    'elections?',
    'vote',
    'referendum',
    'opposition',
    'protests?',
    'protesters',
    'UN Security Council',
    'United Nations',
    'NATO',
    'African Union',
    'European Union',
    'BRICS',
    'G7',
    'G20',
    'EAC',
    'SADC',
    'ECOWAS',
    'bilateral',
    'border',
    'sovereignty',
    'impeach(?:ed|ment)?',
    'cabinet',
    'peace (?:deal|talks|accord|agreement)',
    'government',
    'minister',
    'senate',
    'congress',
    'tariffs?',
  ]),
  economy: words([
    'econom(?:y|ic|ies)',
    'inflation',
    'GDP',
    'central bank',
    'interest rates?',
    'rate cut',
    'rate hike',
    'stocks?',
    'shares',
    'markets?',
    'oil prices?',
    'crude',
    'gold',
    'currency',
    'dollar',
    'debt',
    'IMF',
    'World Bank',
    'trade',
    'exports?',
    'imports?',
    'investors?',
    'investment',
    'budget',
    'tax(?:es)?',
    'tariffs?',
    'bank(?:s|ing)?',
    'billion',
    'recession',
    'jobs',
    'unemployment',
    'supply chain',
    'mining',
    'OPEC',
    'bonds?',
    'bitcoin',
    'earnings',
  ]),
  technology: words([
    'artificial intelligence',
    'chips?',
    'semiconductors?',
    'cyber(?:attack|security)?',
    'hack(?:ers|ed|ing)?',
    'data breach',
    'software',
    'startups?',
    'satellites?',
    'spacecraft',
    'rocket launch',
    'robots?',
    'OpenAI',
    'Anthropic',
    'Google',
    'Apple',
    'Microsoft',
    'Nvidia',
    'quantum',
    'smartphones?',
    'internet',
    'tech',
    'SpaceX',
    '5G',
  ]),
  disaster: words([
    'earthquakes?',
    'floods?',
    'flooding',
    'cyclone',
    'hurricane',
    'typhoon',
    'landslides?',
    'wildfires?',
    'volcan(?:o|ic)',
    'eruption',
    'drought',
    'famine',
    'tsunami',
    'plane crash',
    'shipwreck',
    'capsized',
    'collapsed?',
    'explosion',
    'storm',
    'heatwave',
    'evacuat(?:e|ed|ion)',
  ]),
  health: words([
    'Ebola',
    'Marburg',
    'cholera',
    'mpox',
    'malaria',
    'measles',
    'outbreak',
    'epidemic',
    'pandemic',
    'virus',
    'vaccines?',
    'World Health Organi[sz]ation',
    'hospitals?',
    'disease',
    'health ministry',
    'HIV',
    'polio',
  ]),
  entertainment: words([
    'celebrity',
    'celebrities',
    'singer',
    'actor',
    'actress',
    'film',
    'movie',
    'album',
    'concert',
    'Oscars?',
    'Grammy',
    'Hollywood',
    'box office',
    'reality TV',
    'fashion',
    'red carpet',
    'Netflix',
    'football',
    'soccer',
    'Premier League',
    'Champions League',
    'World Cup',
    'AFCON',
    'tennis',
    'NBA',
    'cricket',
    'rugby',
    'striker',
    'coach',
    'Formula 1',
    'boxing',
    'cycling',
    'marathon',
    'music',
    'influencer',
    'royal family',
    'tournament',
    'midfielder',
    'recipe',
    'horoscope',
    'quiz',
  ]),
};

const CATEGORY_WEIGHT = {
  conflict: 30,
  geopolitics: 25,
  disaster: 24,
  economy: 20,
  health: 20,
  technology: 18,
  society: 6,
  entertainment: -22,
};

const CRITICAL = words([
  'breaking',
  'urgent',
  'state of emergency',
  'martial law',
  'coup',
  'assassinat(?:ed|ion)',
  'declares? war',
  'invasion',
  'invades?',
  'nuclear',
  'missile',
  'ceasefire',
  'mass casualt(?:y|ies)',
  'evacuat(?:e|ed|ion)',
  'dozens killed',
  'hundreds killed',
  'killed',
  'dead',
  'deaths',
  'hostages?',
  'resign(?:s|ed)',
  'collapse[sd]?',
  'default',
  'Ebola',
  'Marburg',
  'famine',
  'genocide',
  'sanctions',
  'massacre',
  'shot down',
  'shutdown',
]);
const ESCALATION =
  /\b(?:at least|more than|over)?\s*(\d{2,6})\s+(?:people\s+)?(?:killed|dead|die|deaths|missing)\b/i;

const distinct = (text, pattern) =>
  new Set((text.match(pattern) || []).map((term) => term.toLowerCase())).size;

/** Decide the desk from the words, falling back to a specialist feed's own. */
export function classifyStory({ title, summary = '', category = null }) {
  const scores = Object.fromEntries(
    Object.entries(CATEGORY_TERMS).map(([name, pattern]) => [
      name,
      distinct(title, pattern) * 2 + distinct(summary, pattern),
    ]),
  );
  // Case matters here: "who" and "fed" are ordinary words.
  if (/\bWHO\b/.test(title)) scores.health += 2;
  if (/\bAI\b/.test(title)) scores.technology += 2;
  if (/\bFed\b/.test(title)) scores.economy += 2;
  if (category) scores[category] += 2;
  const hard = Object.entries(scores)
    .filter(([name]) => name !== 'entertainment')
    .sort((a, b) => b[1] - a[1])[0];
  // Celebrity and sport stories rise only when a critical subject is as strong.
  if (scores.entertainment > 0 && scores.entertainment > hard[1])
    return 'entertainment';
  return hard[1] >= 2 ? hard[0] : 'society';
}

export function severityOf({ title, summary = '' }) {
  const hits = distinct(title, CRITICAL) * 2 + distinct(summary, CRITICAL);
  const toll = Number(
    ESCALATION.exec(title)?.[1] || ESCALATION.exec(summary)?.[1] || 0,
  );
  return Math.min(
    24,
    hits * 4 + (toll >= 100 ? 12 : toll >= 20 ? 8 : toll ? 4 : 0),
  );
}

const STOP = new Set(
  'the a an of in on at to for and or is are was were be been as by with from after over into amid says said say new will has have had its it his her their this that than more about against up out who what how why when not no but you your they he she we us day week year live update updates video watch latest first could would may two three news report reports'.split(
    ' ',
  ),
);

export function titleTokens(title) {
  return new Set(
    String(title)
      .toLowerCase()
      .replace(/['’]s\b/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 2 && !STOP.has(token))
      .map((token) =>
        token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token,
      ),
  );
}

function overlap(a, b) {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return { shared, ratio: shared / Math.max(1, Math.min(a.size, b.size)) };
}

/** Same event: enough shared words, published within a day and a half. */
function sameEvent(a, b) {
  if (Math.abs(a.publishedAt - b.publishedAt) > 36 * 3_600_000) return false;
  const { shared, ratio } = overlap(a.tokens, b.tokens);
  return (shared >= 4 && ratio >= 0.5) || (shared >= 3 && ratio >= 0.72);
}

const recencyScore = (ageMs) => 34 * Math.exp(-ageMs / (9 * 3_600_000));

/** Turn raw feed items into ranked, de-duplicated stories with locations. */
export function analyzeNews(items, { now = Date.now(), limit = 400 } = {}) {
  const prepared = [];
  const seenUrls = new Set();
  for (const item of items) {
    if (!item?.title || !item.url || seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    const publishedAt = Math.min(item.publishedAt || now, now);
    if (now - publishedAt > 5 * 86_400_000) continue;
    prepared.push({
      ...item,
      publishedAt,
      dateKnown: Number.isFinite(item.publishedAt),
      tokens: titleTokens(item.title),
    });
  }
  prepared.sort((a, b) => b.publishedAt - a.publishedAt);

  const clusters = [];
  const byToken = new Map();
  for (const item of prepared) {
    const candidates = new Set();
    for (const token of item.tokens)
      for (const index of byToken.get(token) || []) candidates.add(index);
    let home = -1;
    for (const index of candidates) {
      if (sameEvent(item, clusters[index][0])) {
        home = index;
        break;
      }
    }
    if (home >= 0) {
      clusters[home].push(item);
      continue;
    }
    clusters.push([item]);
    for (const token of item.tokens) {
      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token).push(clusters.length - 1);
    }
  }

  const stories = clusters.map((cluster) => {
    const lead = [...cluster].sort(
      (a, b) =>
        b.trust - a.trust ||
        Number(Boolean(b.summary)) - Number(Boolean(a.summary)) ||
        b.publishedAt - a.publishedAt,
    )[0];
    const newest = Math.max(...cluster.map((item) => item.publishedAt));
    const first = Math.min(...cluster.map((item) => item.publishedAt));
    const families = new Set(
      cluster.map((item) => item.family || item.sourceId),
    );
    const summary =
      lead.summary || cluster.find((item) => item.summary)?.summary || '';
    const category = classifyStory({
      title: lead.title,
      summary,
      category: lead.category,
    });
    const severity = severityOf({ title: lead.title, summary });
    let countries = countriesInText(lead.title);
    if (!countries.length) countries = countriesInText(summary).slice(0, 2);
    if (!countries.length) {
      const home = cluster.find((item) => item.home)?.home;
      if (home) countries = [countryByCode(home)].filter(Boolean);
    }
    const eastAfrica =
      countries.some((country) => country.eastAfrica) ||
      cluster.some((item) => item.desk === 'east-africa');
    const africa =
      eastAfrica ||
      countries.some((country) => country.africa) ||
      cluster.some((item) => item.desk === 'africa');
    const corroboration = Math.min(20, (families.size - 1) * 7);
    const raw =
      12 +
      CATEGORY_WEIGHT[category] +
      severity +
      corroboration +
      recencyScore(now - newest) +
      (lead.trust - 3) * 3 +
      (eastAfrica ? 6 : africa ? 4 : 0) -
      (lead.dateKnown ? 0 : 10);
    const priority = Math.round(Math.max(0, Math.min(100, raw)));
    const place = countries[0] || null;
    return {
      id: createHash('sha1')
        .update([...cluster.at(-1).tokens].sort().join(' ') || lead.url)
        .digest('hex')
        .slice(0, 14),
      title: lead.title,
      summary,
      url: lead.url,
      image: lead.image || cluster.find((item) => item.image)?.image || '',
      source: lead.sourceName,
      sourceId: lead.sourceId,
      sources: cluster.slice(0, 10).map((item) => ({
        name: item.sourceName,
        url: item.url,
        title: item.title,
        publishedAt: item.publishedAt,
      })),
      outlets: families.size,
      publishedAt: newest,
      firstSeenAt: first,
      category,
      severity,
      priority,
      level:
        priority >= 82
          ? 'critical'
          : priority >= 66
            ? 'high'
            : priority >= 45
              ? 'elevated'
              : 'routine',
      africa,
      eastAfrica,
      countries: countries
        .slice(0, 4)
        .map(({ iso2, name }) => ({ iso2, name })),
      place: place
        ? { iso2: place.iso2, name: place.name, lat: place.lat, lon: place.lon }
        : null,
    };
  });
  stories.sort(
    (a, b) => b.priority - a.priority || b.publishedAt - a.publishedAt,
  );
  return stories.slice(0, limit);
}

/** Countries ranked by the weight of current coverage. */
export function hotspotsFrom(stories, { limit = 40 } = {}) {
  const totals = new Map();
  for (const story of stories) {
    if (story.category === 'entertainment') continue;
    story.countries.forEach((country, index) => {
      const place = countryByCode(country.iso2);
      if (!place) return;
      const current = totals.get(country.iso2) || {
        iso2: place.iso2,
        name: place.name,
        lat: place.lat,
        lon: place.lon,
        africa: place.africa,
        eastAfrica: place.eastAfrica,
        score: 0,
        count: 0,
        topStoryId: story.id,
        topTitle: story.title,
        categories: {},
      };
      current.score += (story.priority * (index ? 0.4 : 1)) / 10;
      current.count += 1;
      current.categories[story.category] =
        (current.categories[story.category] || 0) + 1;
      totals.set(country.iso2, current);
    });
  }
  return [...totals.values()]
    .map((spot) => ({ ...spot, score: Math.round(spot.score) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Terms carried by several outlets in the last day, with the prior half-day. */
export function trendsFrom(stories, { now = Date.now(), limit = 16 } = {}) {
  const terms = new Map();
  const phrase = /\p{Lu}[\p{L}\p{N}’'-]+(?:\s+\p{Lu}[\p{L}\p{N}’'-]+){0,2}/gu;
  const ignore =
    /^(?:The|A|An|In|On|At|To|For|And|How|Why|What|Who|When|After|With|From|As|Is|It|He|She|They|This|That|New|Live|Watch|Video|Breaking|Exclusive|Here|Will|Can|More|Two|Three|First|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Opinion|Analysis|News)$/;
  for (const story of stories) {
    if (story.category === 'entertainment') continue;
    const found = new Set();
    for (const [match] of story.title.matchAll(phrase)) {
      const parts = match.replace(/['’]s\b/g, '').split(/\s+/);
      while (parts.length && ignore.test(parts[0])) parts.shift();
      while (parts.length && ignore.test(parts.at(-1))) parts.pop();
      const phraseText = parts.join(' ');
      // "Russian" and "Moscow" belong with "Russia".
      const [place] = parts.length < 3 ? countriesInText(phraseText) : [];
      const term =
        place && new RegExp(`^(?:${place.pattern.source})$`, 'u').test(phraseText)
          ? place.name
          : phraseText;
      if (term.length > 2 && !ignore.test(term)) found.add(term);
    }
    for (const term of found) {
      const key = term.toLowerCase();
      const row = terms.get(key) || {
        term,
        count: 0,
        outlets: 0,
        recent: 0,
        previous: 0,
        score: 0,
      };
      row.count += 1;
      row.outlets += story.outlets;
      row.score += story.priority;
      const age = now - story.publishedAt;
      if (age < 12 * 3_600_000) row.recent += 1;
      else if (age < 24 * 3_600_000) row.previous += 1;
      terms.set(key, row);
    }
  }
  return [...terms.values()]
    .filter((row) => row.count >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ term, count, outlets, recent, previous }) => ({
      term,
      count,
      outlets,
      direction:
        recent > previous ? 'rising' : recent < previous ? 'cooling' : 'steady',
    }));
}
