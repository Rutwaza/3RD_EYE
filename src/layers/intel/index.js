import {
  registerPickOwner,
  unregisterPickOwner,
} from '../../data/pickRegistry.js';
import { createIntelPointLayer } from './pointLayer.js';

export const INTEL_SELECTED_EVENT = 'third-eye:intel-selected';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const bundled = {
  airports: new URL(
    '../../data/local_data/africa/airports.json',
    import.meta.url,
  ).href,
  power: new URL('../../data/local_data/africa/power.json', import.meta.url)
    .href,
  volcanoes: new URL(
    '../../data/local_data/africa/volcanoes.json',
    import.meta.url,
  ).href,
  facilities: new URL(
    '../../data/local_data/africa/facilities.json',
    import.meta.url,
  ).href,
};

const kind = (label, color, shape) => ({ label, color, shape });

/** Read local JSON or one of the server's fixed intelligence feeds. */
export function createIntelSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiRoot = '/api/intel',
} = {}) {
  async function read(url, signal, cache) {
    const response = await fetchImpl(url, { signal, cache });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `HTTP ${response.status}`);
    }
    return response.json();
  }
  return Object.freeze({
    feed: (name, { signal } = {}) =>
      read(`${apiRoot}/${name}`, signal, 'no-store'),
    bundle: (name, { signal } = {}) =>
      read(bundled[name], signal, 'force-cache'),
  });
}

/** Located headlines: one marker per country, sized by current coverage. */
async function newsItems(source, options) {
  const news = await source.feed('news', options);
  return {
    updatedAt: news.updatedAt,
    stale: news.stale,
    items: news.hotspots.map((spot) => {
      const top = news.stories
        .filter((story) =>
          story.countries.some(({ iso2 }) => iso2 === spot.iso2),
        )
        .slice(0, 6);
      const category = Object.entries(spot.categories).sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0];
      return {
        id: `news-${spot.iso2}`,
        lat: spot.lat,
        lon: spot.lon,
        title: spot.name,
        badge: String(spot.count),
        kind: category,
        weight: Math.max(5, Math.min(12, 4 + Math.sqrt(spot.score) * 0.7)),
        details: [
          ['Stories', String(spot.count)],
          ['Coverage weight', String(spot.score)],
        ],
        stories: top,
        source: 'World Desk',
      };
    }),
  };
}

async function volcanoItems(source, options) {
  const [base, activity] = await Promise.all([
    source.bundle('volcanoes', options),
    source.feed('volcanoes', options).catch(() => ({ items: [] })),
  ]);
  const active = new Map(
    activity.items.map((item) => [item.name.toLowerCase(), item]),
  );
  return {
    updatedAt: activity.updatedAt,
    items: base.items.map((item) => {
      const report = active.get(item.title.toLowerCase());
      return report
        ? {
            ...item,
            kind: 'active',
            weight: 10,
            summary: report.summary,
            url: report.url,
            at: report.at,
          }
        : item;
    }),
  };
}

/** Definitions for the Africa and world-pulse layers. */
export function intelLayerDefinitions(source) {
  const feed = (name) => (options) => source.feed(name, options);
  const bundle = (name) => (options) => source.bundle(name, options);
  return [
    {
      id: 'world-news',
      name: 'World news pulse',
      icon: '◉',
      source: '35 newsrooms · World Desk',
      updateInterval: 2 * MINUTE,
      shape: 'pulse',
      kinds: {
        conflict: kind('Conflict', '#ff4d6d'),
        geopolitics: kind('Geopolitics', '#9b7bff'),
        economy: kind('Economy', '#3ee6a8'),
        technology: kind('Technology', '#35d6ff'),
        disaster: kind('Disaster', '#ff9f43'),
        health: kind('Health', '#ffd166'),
        society: kind('Society', '#8fa6bf'),
      },
      fetchItems: (options) => newsItems(source, options),
    },
    {
      id: 'crisis-alerts',
      name: 'Disaster alerts',
      icon: '⚠',
      source: 'GDACS · NASA EONET',
      updateInterval: 10 * MINUTE,
      shape: 'triangle',
      kinds: {
        red: kind('Red', '#ff4d6d'),
        orange: kind('Orange', '#ff9f43'),
        green: kind('Green', '#3ee6a8'),
        watch: kind('Watch', '#35d6ff'),
      },
      fetchItems: feed('crises'),
    },
    {
      id: 'health-outbreaks',
      name: 'Disease outbreaks',
      icon: '✚',
      source: 'WHO',
      updateInterval: 2 * HOUR,
      shape: 'diamond',
      kinds: {
        recent: kind('Last 60 days', '#ffd166'),
        past: kind('Earlier', '#a08a52'),
      },
      fetchItems: feed('outbreaks'),
    },
    {
      id: 'africa-facilities',
      name: 'East Africa facilities',
      icon: '⌂',
      source: 'OpenStreetMap',
      shape: 'square',
      kinds: {
        hospital: kind('Hospitals', '#ff7a9c'),
        refuge: kind('Refugee sites', '#ffd166'),
        grid: kind('Substations', '#35d6ff'),
        mine: kind('Mines', '#c79a6b'),
        border: kind('Border posts', '#9b7bff', 'diamond'),
        port: kind('Ports', '#4f8cff', 'diamond'),
      },
      fetchItems: bundle('facilities'),
    },
    {
      id: 'africa-airports',
      name: 'African airports',
      icon: '✈',
      source: 'OurAirports',
      shape: 'diamond',
      kinds: {
        large: kind('Large', '#35d6ff'),
        medium: kind('Medium', '#5fa8ff'),
        small: kind('Airstrips', '#6c86a8'),
      },
      fetchItems: bundle('airports'),
    },
    {
      id: 'africa-power',
      name: 'African power plants',
      icon: '⚡',
      source: 'WRI Global Power Plant Database',
      shape: 'square',
      kinds: {
        hydro: kind('Hydro', '#35d6ff'),
        solar: kind('Solar', '#ffd166'),
        wind: kind('Wind', '#7cf5c4'),
        geothermal: kind('Geothermal', '#ff9f43'),
        nuclear: kind('Nuclear', '#9b7bff'),
        biomass: kind('Biomass', '#8fce5a'),
        thermal: kind('Thermal', '#ff6b6b'),
      },
      fetchItems: bundle('power'),
    },
    {
      id: 'africa-environment',
      name: 'Weather and air quality',
      icon: '☁',
      source: 'Open-Meteo · modelled',
      updateInterval: 20 * MINUTE,
      kinds: {
        good: kind('Good', '#3ee6a8'),
        moderate: kind('Moderate', '#ffd166'),
        sensitive: kind('Sensitive', '#ff9f43'),
        unhealthy: kind('Unhealthy', '#ff4d6d'),
        unknown: kind('No reading', '#8fa6bf'),
      },
      fetchItems: feed('environment'),
    },
    {
      id: 'africa-rivers',
      name: 'River levels',
      icon: '≋',
      source: 'GloFAS · modelled',
      updateInterval: 6 * HOUR,
      shape: 'diamond',
      kinds: {
        surge: kind('Surge', '#ff4d6d'),
        rising: kind('Rising', '#ff9f43'),
        normal: kind('Normal', '#4f8cff'),
      },
      fetchItems: feed('rivers'),
    },
    {
      id: 'africa-seismic',
      name: 'African earthquakes (30d)',
      icon: '◌',
      source: 'USGS',
      updateInterval: 5 * MINUTE,
      shape: 'pulse',
      kinds: {
        major: kind('M5+', '#ff4d6d'),
        quake: kind('M2.5+', '#ff9f43'),
      },
      fetchItems: feed('seismic'),
    },
    {
      id: 'africa-volcanoes',
      name: 'African volcanoes',
      icon: '▲',
      source: 'Smithsonian GVP',
      updateInterval: 6 * HOUR,
      shape: 'triangle',
      kinds: {
        active: kind('Active now', '#ff4d6d'),
        historic: kind('Since 1900', '#ff9f43'),
        holocene: kind('Older', '#b3836a'),
      },
      fetchItems: (options) => volcanoItems(source, options),
    },
    {
      id: 'africa-economy',
      name: 'Country economies',
      icon: '◈',
      source: 'World Bank',
      updateInterval: 24 * HOUR,
      kinds: {
        fast: kind('6%+', '#3ee6a8'),
        growing: kind('2–6%', '#7cd8ff'),
        slow: kind('0–2%', '#ffd166'),
        shrinking: kind('Shrinking', '#ff4d6d'),
        unknown: kind('No figure', '#8fa6bf'),
      },
      fetchItems: feed('economy'),
    },
    {
      id: 'africa-displacement',
      name: 'Displaced people',
      icon: '⛺',
      source: 'UNHCR',
      updateInterval: 24 * HOUR,
      kinds: {
        severe: kind('1M+', '#ff4d6d'),
        high: kind('100k+', '#ff9f43'),
        present: kind('Under 100k', '#9b7bff'),
      },
      fetchItems: feed('displacement'),
    },
  ];
}

/** Build every intelligence layer against one source. */
export function createIntelLayers({
  source = createIntelSource(),
  onSelect = (detail) =>
    globalThis.window?.dispatchEvent(
      new CustomEvent(INTEL_SELECTED_EVENT, { detail }),
    ),
} = {}) {
  return intelLayerDefinitions(source).map((definition) =>
    createIntelPointLayer({
      ...definition,
      onSelect,
      registerPickOwner,
      unregisterPickOwner,
    }),
  );
}
