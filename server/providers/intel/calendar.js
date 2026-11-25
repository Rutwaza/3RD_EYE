import { fetchJson } from './fetch.js';
import { countriesInText, countryByCode } from './gazetteer.js';

const CURRENCY_HOME = {
  USD: 'US',
  EUR: 'BE',
  GBP: 'GB',
  JPY: 'JP',
  CNY: 'CN',
  CAD: 'CA',
  AUD: 'AU',
  NZD: 'NZ',
  CHF: 'CH',
};

const placed = (country) =>
  country
    ? {
        iso2: country.iso2,
        name: country.name,
        lat: country.lat,
        lon: country.lon,
        africa: country.africa,
        eastAfrica: country.eastAfrica,
      }
    : null;

async function economicEvents(read, now) {
  const rows = await read(
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  );
  return rows
    .filter((row) => row.impact === 'High' || row.impact === 'Medium')
    .map((row) => ({
      id: `eco-${row.country}-${row.title}-${row.date}`,
      kind: 'economy',
      title: `${row.country} · ${row.title}`,
      at: Date.parse(row.date),
      allDay: false,
      weight: row.impact === 'High' ? 3 : 1,
      detail: [
        row.forecast && `Forecast ${row.forecast}`,
        row.previous && `Previous ${row.previous}`,
      ]
        .filter(Boolean)
        .join(' · '),
      place: placed(countryByCode(CURRENCY_HOME[row.country])),
      url: 'https://www.forexfactory.com/calendar',
      source: 'Forex Factory',
    }))
    .filter((event) => event.at > now - 6 * 3_600_000);
}

/** Future-dated Wikidata records; the range hint keeps the scan bounded. */
const range = (property, now, days) =>
  `?e wdt:${property} ?date. hint:Prior hint:rangeSafe true. FILTER("${new Date(now).toISOString()}"^^xsd:dateTime < ?date && ?date < "${new Date(now + days * 86_400_000).toISOString()}"^^xsd:dateTime)`;
const label = '?e rdfs:label ?eLabel. FILTER(LANG(?eLabel) = "en")';
const home = 'OPTIONAL { ?e wdt:P17 ?c. ?c wdt:P297 ?code. }';
const SUMMIT_NAMES = [
  'summit',
  'G20',
  'G7',
  'BRICS',
  'NATO',
  'African Union',
  'Climate Change Conference',
  'General Assembly',
  'Commonwealth Heads',
  'World Economic Forum',
  'Security Conference',
  'National Congress of the',
  'referendum',
]
  .map((name) => `(^|[^a-z0-9])${name}([^a-z0-9]|$)`)
  .join('|');

const electionsQuery = (
  now,
) => `SELECT ?e ?eLabel ?date (SAMPLE(?code) AS ?iso) WHERE {
  ${range('P585', now, 300)}
  ?e wdt:P31 ?t. ?t wdt:P279* wd:Q40231.
  ${label}
  FILTER(!REGEX(?eLabel, "county|mayor|city|council|magistrate|leadership|by-election|municipal", "i"))
  ${home}
} GROUP BY ?e ?eLabel ?date ORDER BY ?date LIMIT 200`;

const summitsQuery = (
  now,
) => `SELECT ?e ?eLabel ?date (SAMPLE(?code) AS ?iso) WHERE {
  { ${range('P585', now, 365)} } UNION { ${range('P580', now, 365)} }
  ${label}
  FILTER(REGEX(?eLabel, "${SUMMIT_NAMES}", "i") && !REGEX(?eLabel, "AI Summit|Catalyst|Therapeutic", "i"))
  ${home}
} GROUP BY ?e ?eLabel ?date ORDER BY ?date LIMIT 60`;

async function wikidataEvents(read, query, kind) {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const body = await read(url, {
    timeoutMs: 30_000,
    headers: { Accept: 'application/sparql-results+json' },
  });
  return (
    (body.results?.bindings || [])
      .map((row) => {
        const title = row.eLabel?.value || '';
        const id = String(row.e?.value || '')
          .split('/')
          .at(-1);
        const country =
          countryByCode(row.iso?.value) || countriesInText(title)[0] || null;
        const national =
          /general|presidential|parliamentary|legislative|federal/i;
        return {
          id: `${kind}-${id}`,
          kind,
          title,
          at: Date.parse(row.date?.value),
          allDay: true,
          // Wikidata stores "some time in 2027" as the first of January.
          approximate: /-01-01T/.test(row.date?.value || ''),
          weight: kind === 'election' ? (national.test(title) ? 3 : 1) : 2,
          detail: country ? country.name : '',
          place: placed(country),
          url: `https://www.wikidata.org/wiki/${id}`,
          source: 'Wikidata',
        };
      })
      // An unlabelled record shows its raw Q-number, which tells a reader nothing.
      .filter(
        (event) =>
          event.title &&
          !/^Q\d+$/.test(event.title) &&
          Number.isFinite(event.at),
      )
  );
}

async function launchEvents(read) {
  const body = await read(
    'https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=12&mode=list',
  );
  return (body.results || []).map((launch) => ({
    id: `space-${launch.id}`,
    kind: 'space',
    title: launch.name,
    at: Date.parse(launch.net),
    allDay: false,
    weight: 1,
    detail: launch.location?.name || launch.status?.name || '',
    place: null,
    url: 'https://thespacedevs.com/',
    source: 'Launch Library 2',
  }));
}

/** Scheduled events from public calendars, each with its own outage status. */
export async function readCalendar({
  read = fetchJson,
  now = Date.now(),
} = {}) {
  const feeds = [
    ['economy', 'Economic releases', () => economicEvents(read, now)],
    [
      'election',
      'Elections',
      () => wikidataEvents(read, electionsQuery(now), 'election'),
    ],
    [
      'summit',
      'Summits',
      () => wikidataEvents(read, summitsQuery(now), 'summit'),
    ],
    ['space', 'Space launches', () => launchEvents(read)],
  ];
  const results = await Promise.allSettled(feeds.map(([, , load]) => load()));
  const seen = new Set();
  const events = results
    .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    .filter((event) => {
      const key = `${event.kind}:${event.title.toLowerCase()}`;
      if (!Number.isFinite(event.at) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.at - b.at);
  if (!events.length) throw new Error('No event calendar answered');
  return {
    events,
    sources: feeds.map(([id, name], index) => ({
      id,
      name,
      status: results[index].status === 'fulfilled' ? 'live' : 'down',
      count:
        results[index].status === 'fulfilled' ? results[index].value.length : 0,
    })),
  };
}

const FX = [
  'RWF',
  'KES',
  'UGX',
  'TZS',
  'BIF',
  'CDF',
  'ETB',
  'ZAR',
  'NGN',
  'EGP',
  'EUR',
  'GBP',
  'CNY',
];
const TICKERS = [
  ['GC=F', 'Gold'],
  ['BZ=F', 'Brent oil'],
  ['^GSPC', 'S&P 500'],
  ['HG=F', 'Copper'],
];

/** Indicative market levels. Display only; never trading information. */
export async function readMarkets({ read = fetchJson } = {}) {
  const [fx, crypto, ...quotes] = await Promise.allSettled([
    read('https://open.er-api.com/v6/latest/USD'),
    read(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true',
    ),
    ...TICKERS.map(([symbol]) =>
      read(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1h`,
      ),
    ),
  ]);
  const rows = [];
  quotes.forEach((result, index) => {
    const meta =
      result.status === 'fulfilled'
        ? result.value?.chart?.result?.[0]?.meta
        : null;
    if (!Number.isFinite(meta?.regularMarketPrice)) return;
    const before = meta.chartPreviousClose;
    rows.push({
      id: TICKERS[index][0],
      label: TICKERS[index][1],
      value: meta.regularMarketPrice,
      change: before
        ? ((meta.regularMarketPrice - before) / before) * 100
        : null,
      group: 'market',
    });
  });
  if (crypto.status === 'fulfilled')
    for (const [id, label] of [
      ['bitcoin', 'Bitcoin'],
      ['ethereum', 'Ethereum'],
    ])
      if (Number.isFinite(crypto.value?.[id]?.usd))
        rows.push({
          id,
          label,
          value: crypto.value[id].usd,
          change: crypto.value[id].usd_24h_change ?? null,
          group: 'market',
        });
  if (fx.status === 'fulfilled')
    for (const code of FX)
      if (Number.isFinite(fx.value?.rates?.[code]))
        rows.push({
          id: `USD${code}`,
          label: `USD/${code}`,
          value: fx.value.rates[code],
          change: null,
          group: 'fx',
        });
  if (!rows.length) throw new Error('No market source answered');
  return { rows };
}
