import {
  AFRICA_BOUNDS,
  AFRICA_COUNTRIES,
  isWithinAfrica,
} from '../../../src/data/africa.js';
import { fetchJson, fetchText } from './fetch.js';
import { countriesInText } from './gazetteer.js';
import { parseFeed, plainText, safeHttpUrl } from './rss.js';

const [WEST, SOUTH, EAST, NORTH] = AFRICA_BOUNDS;
const point = (lat, lon) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180;

/** name|country|lat|lon — East African cities first, then the continent. */
const CITIES = `
Kigali|RW|-1.944|30.062
Musanze|RW|-1.5|29.634
Huye|RW|-2.597|29.739
Rubavu|RW|-1.68|29.26
Rusizi|RW|-2.485|28.907
Nyagatare|RW|-1.3|30.327
Bujumbura|BI|-3.383|29.362
Gitega|BI|-3.427|29.925
Goma|CD|-1.679|29.222
Bukavu|CD|-2.509|28.861
Bunia|CD|1.566|30.252
Kisangani|CD|0.515|25.191
Kampala|UG|0.348|32.582
Gulu|UG|2.775|32.299
Mbarara|UG|-0.607|30.655
Nairobi|KE|-1.286|36.817
Mombasa|KE|-4.044|39.668
Kisumu|KE|-0.092|34.768
Eldoret|KE|0.514|35.27
Garissa|KE|-0.453|39.646
Dar es Salaam|TZ|-6.792|39.208
Dodoma|TZ|-6.163|35.752
Mwanza|TZ|-2.517|32.9
Arusha|TZ|-3.387|36.683
Kigoma|TZ|-4.877|29.627
Zanzibar|TZ|-6.165|39.199
Juba|SS|4.859|31.571
Malakal|SS|9.534|31.66
Mogadishu|SO|2.047|45.318
Hargeisa|SO|9.56|44.065
Kismayo|SO|-0.358|42.545
Addis Ababa|ET|9.03|38.74
Mekelle|ET|13.497|39.476
Djibouti|DJ|11.572|43.145
Asmara|ER|15.323|38.925
Khartoum|SD|15.501|32.56
Port Sudan|SD|19.616|37.216
El Fasher|SD|13.63|25.35
Kinshasa|CD|-4.322|15.307
Lubumbashi|CD|-11.665|27.479
Lusaka|ZM|-15.387|28.323
Harare|ZW|-17.825|31.034
Lilongwe|MW|-13.963|33.774
Maputo|MZ|-25.966|32.583
Pemba|MZ|-12.974|40.518
Johannesburg|ZA|-26.204|28.047
Cape Town|ZA|-33.925|18.424
Durban|ZA|-29.858|31.022
Windhoek|NA|-22.56|17.066
Luanda|AO|-8.839|13.289
Antananarivo|MG|-18.879|47.508
Yaounde|CM|3.848|11.502
N'Djamena|TD|12.134|15.056
Lagos|NG|6.524|3.379
Abuja|NG|9.058|7.495
Kano|NG|12.002|8.592
Accra|GH|5.604|-0.187
Abidjan|CI|5.36|-4.008
Dakar|SN|14.693|-17.447
Bamako|ML|12.639|-8.003
Ouagadougou|BF|12.371|-1.52
Niamey|NE|13.514|2.109
Cairo|EG|30.044|31.236
Tripoli|LY|32.887|13.191
Tunis|TN|36.806|10.181
Algiers|DZ|36.754|3.059
Casablanca|MA|33.573|-7.59
`
  .trim()
  .split('\n')
  .map((row) => {
    const [name, iso2, lat, lon] = row.trim().split('|');
    return { name, iso2, lat: Number(lat), lon: Number(lon) };
  });

/** name|lat|lon — river reaches read from the public GloFAS model. */
const RIVERS = `
Nyabarongo at Kigali|-2.02|30.02
Akagera at Rusumo|-2.38|30.78
Ruzizi at Bugarama|-2.73|29.02
Nile at Jinja|0.43|33.2
Victoria Nile at Murchison|2.28|31.68
Albert Nile at Nimule|3.6|32.05
White Nile at Juba|4.85|31.62
White Nile at Malakal|9.53|31.65
Sobat near Malakal|9.33|31.75
Blue Nile at Roseires|11.85|34.38
Nile at Khartoum|15.65|32.52
Atbara at Kassala|15.25|35.9
Tana at Garissa|-0.45|39.65
Nzoia at Budalangi|0.12|34.02
Galana near Malindi|-3.12|40.08
Juba at Bardera|2.35|42.28
Shabelle at Beledweyne|4.73|45.2
Awash at Dubti|11.72|41.08
Omo at Omorate|4.8|36.05
Rufiji at Stiegler's|-7.8|37.85
Pangani at Korogwe|-5.15|38.48
Kagera at Kyaka|-1.25|31.42
Semliki at Bweramule|0.98|30.18
Congo at Kisangani|0.5|25.2
Congo at Kinshasa|-4.28|15.32
Zambezi at Tete|-16.15|33.58
Limpopo at Chokwe|-24.5|33.02
Niger at Niamey|13.5|2.1
Benue at Makurdi|7.73|8.53
Senegal at Bakel|14.9|-12.45
`
  .trim()
  .split('\n')
  .map((row) => {
    const [name, lat, lon] = row.trim().split('|');
    return { name, lat: Number(lat), lon: Number(lon) };
  });

const list = (body) => (Array.isArray(body) ? body : [body]);

export async function readSeismic({ read = fetchJson } = {}) {
  const url = new URL('https://earthquake.usgs.gov/fdsnws/event/1/query');
  url.search = new URLSearchParams({
    format: 'geojson',
    minmagnitude: '2.5',
    minlatitude: SOUTH,
    maxlatitude: NORTH,
    minlongitude: WEST,
    maxlongitude: EAST,
    starttime: new Date(Date.now() - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10),
    orderby: 'time',
    limit: '400',
  });
  const body = await read(url.href);
  return {
    items: body.features
      .map(({ id, geometry, properties }) => ({
        id,
        lat: geometry?.coordinates?.[1],
        lon: geometry?.coordinates?.[0],
        title: `M${Number(properties.mag).toFixed(1)} · ${properties.place || 'Africa'}`,
        kind: properties.mag >= 5 ? 'major' : 'quake',
        weight: properties.mag,
        at: properties.time,
        details: [
          ['Depth', `${Math.round(geometry?.coordinates?.[2] ?? 0)} km`],
        ],
        url: safeHttpUrl(properties.url),
        source: 'USGS',
      }))
      .filter(({ lat, lon }) => point(lat, lon) && isWithinAfrica(lat, lon)),
  };
}

const GDACS_TYPES = {
  EQ: 'Earthquake',
  TC: 'Tropical cyclone',
  FL: 'Flood',
  VO: 'Volcano',
  DR: 'Drought',
  WF: 'Wildfire',
};

/** Active natural-disaster alerts, worldwide, from GDACS and NASA EONET. */
export async function readCrises({ read = fetchJson } = {}) {
  const [gdacs, eonet] = await Promise.allSettled([
    read('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH'),
    read(
      'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=20&limit=250',
    ),
  ]);
  const items = [];
  if (gdacs.status === 'fulfilled')
    for (const { geometry, properties } of gdacs.value.features || []) {
      const [lon, lat] = geometry?.coordinates || [];
      if (!point(lat, lon)) continue;
      const level = String(properties.alertlevel || '').toLowerCase();
      items.push({
        id: `gdacs-${properties.eventtype}-${properties.eventid}`,
        lat,
        lon,
        title: plainText(
          properties.name || properties.description || 'Disaster alert',
          120,
        ),
        kind: ['red', 'orange'].includes(level) ? level : 'green',
        weight: level === 'red' ? 8 : level === 'orange' ? 6 : 4,
        at: Date.parse(properties.datemodified || properties.todate) || null,
        details: [
          ['Type', GDACS_TYPES[properties.eventtype] || properties.eventtype],
          ['Alert', level || 'unknown'],
          ['Country', plainText(properties.country, 80)],
          ['Severity', plainText(properties.severitydata?.severitytext, 90)],
        ].filter(([, value]) => value),
        url: safeHttpUrl(properties.url?.report),
        source: 'GDACS',
        africa: isWithinAfrica(lat, lon),
      });
    }
  if (eonet.status === 'fulfilled')
    for (const event of eonet.value.events || []) {
      const category = event.categories?.[0]?.title || '';
      // GDACS already covers fires and cyclones; EONET adds the rest.
      if (/wildfire|storm/i.test(category)) continue;
      const geometry = event.geometry?.at(-1);
      if (geometry?.type !== 'Point') continue;
      const [lon, lat] = geometry.coordinates;
      if (!point(lat, lon)) continue;
      items.push({
        id: `eonet-${event.id}`,
        lat,
        lon,
        title: plainText(event.title, 120),
        kind: 'watch',
        weight: 4,
        at: Date.parse(geometry.date) || null,
        details: [['Type', category]],
        url: safeHttpUrl(event.sources?.[0]?.url),
        source: 'NASA EONET',
        africa: isWithinAfrica(lat, lon),
      });
    }
  if (gdacs.status === 'rejected' && eonet.status === 'rejected')
    throw new Error('No disaster source answered');
  return { items: items.slice(0, 600) };
}

/** Outbreak notices, placed on the countries their titles name. */
export async function readOutbreaks({ read = fetchJson } = {}) {
  const body = await read(
    'https://www.who.int/api/news/diseaseoutbreaknews?$top=60&$orderby=PublicationDate%20desc&$select=Id,Title,UrlName,PublicationDate,Summary',
    { maxBytes: 6 * 1024 * 1024 },
  );
  const items = [];
  for (const row of body.value || []) {
    const title = plainText(row.Title, 140);
    const countries = countriesInText(title);
    const at = Date.parse(row.PublicationDate);
    if (!countries.length || Date.now() - at > 540 * 86_400_000) continue;
    for (const country of countries.slice(0, 3))
      items.push({
        id: `who-${row.Id || row.UrlName}-${country.iso2}`,
        lat: country.lat,
        lon: country.lon,
        title,
        kind: Date.now() - at < 60 * 86_400_000 ? 'recent' : 'past',
        weight: Date.now() - at < 60 * 86_400_000 ? 8 : 5,
        at,
        details: [['Country', country.name]],
        summary: plainText(row.Summary, 400),
        url: row.UrlName
          ? `https://www.who.int/emergencies/disease-outbreak-news/item/${encodeURIComponent(row.UrlName)}`
          : '',
        source: 'WHO Disease Outbreak News',
        africa: country.africa,
      });
  }
  return { items };
}

const WEATHER = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  80: 'Showers',
  81: 'Showers',
  82: 'Violent showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm, hail',
  99: 'Thunderstorm, hail',
};

/** Current weather and modelled air quality for African cities. */
export async function readEnvironment({ read = fetchJson } = {}) {
  const lat = CITIES.map((city) => city.lat).join(',');
  const lon = CITIES.map((city) => city.lon).join(',');
  const [weather, air] = await Promise.allSettled([
    read(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation`,
    ),
    read(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10,us_aqi`,
    ),
  ]);
  if (weather.status === 'rejected' && air.status === 'rejected')
    throw new Error('No weather source answered');
  const skies = weather.status === 'fulfilled' ? list(weather.value) : [];
  const airs = air.status === 'fulfilled' ? list(air.value) : [];
  return {
    items: CITIES.map((city, index) => {
      const sky = skies[index]?.current;
      const quality = airs[index]?.current;
      const aqi = quality?.us_aqi;
      return {
        id: `env-${city.iso2}-${city.name}`,
        lat: city.lat,
        lon: city.lon,
        title: city.name,
        badge: Number.isFinite(sky?.temperature_2m)
          ? `${Math.round(sky.temperature_2m)}°`
          : '',
        kind: !Number.isFinite(aqi)
          ? 'unknown'
          : aqi > 150
            ? 'unhealthy'
            : aqi > 100
              ? 'sensitive'
              : aqi > 50
                ? 'moderate'
                : 'good',
        weight: 5,
        at: Date.now(),
        details: [
          ['Sky', WEATHER[sky?.weather_code]],
          [
            'Temperature',
            Number.isFinite(sky?.temperature_2m) && `${sky.temperature_2m} °C`,
          ],
          [
            'Humidity',
            Number.isFinite(sky?.relative_humidity_2m) &&
              `${sky.relative_humidity_2m}%`,
          ],
          [
            'Wind',
            Number.isFinite(sky?.wind_speed_10m) &&
              `${sky.wind_speed_10m} km/h`,
          ],
          [
            'Rain now',
            Number.isFinite(sky?.precipitation) && `${sky.precipitation} mm`,
          ],
          ['US AQI (model)', Number.isFinite(aqi) && String(Math.round(aqi))],
          [
            'PM2.5 (model)',
            Number.isFinite(quality?.pm2_5) && `${quality.pm2_5} µg/m³`,
          ],
        ].filter(([, value]) => value),
        url: 'https://open-meteo.com/',
        source: 'Open-Meteo · CAMS',
      };
    }),
  };
}

/** Modelled discharge against each reach's own recent range. */
export async function readRivers({ read = fetchJson } = {}) {
  const lat = RIVERS.map((river) => river.lat).join(',');
  const lon = RIVERS.map((river) => river.lon).join(',');
  const body = list(
    await read(
      `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}&daily=river_discharge&past_days=60&forecast_days=10`,
      { timeoutMs: 30_000 },
    ),
  );
  return {
    items: RIVERS.map((river, index) => {
      const daily = body[index]?.daily;
      const flows = daily?.river_discharge || [];
      const past = flows.slice(0, 60).filter(Number.isFinite);
      const next = flows.slice(60).filter(Number.isFinite);
      if (past.length < 20 || !next.length) return null;
      const sorted = [...past].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const high = sorted[Math.floor(sorted.length * 0.95)];
      const peak = Math.max(...next);
      const ratio = median > 0 ? peak / median : 1;
      return {
        id: `river-${river.name}`,
        lat: river.lat,
        lon: river.lon,
        title: river.name,
        kind:
          peak > high * 1.5 && ratio > 2
            ? 'surge'
            : peak > high
              ? 'rising'
              : 'normal',
        weight: peak > high ? 7 : 5,
        at: Date.now(),
        details: [
          ['Today', `${next[0].toFixed(1)} m³/s`],
          ['10-day peak', `${peak.toFixed(1)} m³/s`],
          ['60-day median', `${median.toFixed(1)} m³/s`],
          ['Peak vs median', `${ratio.toFixed(1)}×`],
        ],
        summary:
          'Modelled river discharge, not a gauge reading. Not a flood warning.',
        url: 'https://open-meteo.com/en/docs/flood-api',
        source: 'Open-Meteo · GloFAS',
      };
    }).filter(Boolean),
  };
}

const INDICATORS = [
  ['NY.GDP.MKTP.CD', 'GDP', (v) => `$${(v / 1e9).toFixed(1)} B`],
  ['NY.GDP.MKTP.KD.ZG', 'GDP growth', (v) => `${v.toFixed(1)}%`],
  ['FP.CPI.TOTL.ZG', 'Inflation', (v) => `${v.toFixed(1)}%`],
  ['SP.POP.TOTL', 'Population', (v) => `${(v / 1e6).toFixed(1)} M`],
  ['EG.ELC.ACCS.ZS', 'Electricity access', (v) => `${v.toFixed(0)}%`],
  ['IT.NET.USER.ZS', 'Internet users', (v) => `${v.toFixed(0)}%`],
];

/** Latest World Bank country indicators with their own year. */
export async function readEconomy({ read = fetchJson } = {}) {
  const results = await Promise.allSettled(
    INDICATORS.map(([id]) =>
      read(
        `https://api.worldbank.org/v2/country/all/indicator/${id}?mrnev=1&format=json&per_page=300`,
        { timeoutMs: 40_000 },
      ),
    ),
  );
  if (results.every(({ status }) => status === 'rejected'))
    throw new Error('World Bank is unavailable');
  const values = new Map();
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    for (const row of result.value?.[1] || [])
      if (Number.isFinite(row.value))
        values.set(`${row.countryiso3code}:${index}`, row);
  });
  return {
    items: AFRICA_COUNTRIES.map((country) => {
      const growth = values.get(`${country.iso3}:1`)?.value;
      const gdp = values.get(`${country.iso3}:0`)?.value;
      const details = INDICATORS.map(([, label, format], index) => {
        const row = values.get(`${country.iso3}:${index}`);
        return row ? [label, `${format(row.value)} (${row.date})`] : null;
      }).filter(Boolean);
      return {
        id: `eco-${country.iso2}`,
        lat: country.lat,
        lon: country.lon,
        title: country.name,
        badge: Number.isFinite(growth) ? `${growth.toFixed(1)}%` : '',
        kind: !Number.isFinite(growth)
          ? 'unknown'
          : growth >= 6
            ? 'fast'
            : growth >= 2
              ? 'growing'
              : growth >= 0
                ? 'slow'
                : 'shrinking',
        weight: Number.isFinite(gdp)
          ? Math.max(4, Math.min(10, Math.log10(gdp) - 4))
          : 4,
        details,
        url: `https://data.worldbank.org/country/${country.iso2}`,
        source: 'World Bank',
      };
    }).filter(({ details }) => details.length),
    partial: results.some(({ status }) => status === 'rejected'),
  };
}

/** Refugees and asylum-seekers hosted, by country of asylum. */
export async function readDisplacement({ read = fetchJson } = {}) {
  const year = new Date().getUTCFullYear();
  const body = await read(
    `https://api.unhcr.org/population/v1/population/?limit=1000&yearFrom=${year - 3}&yearTo=${year}&coa_all=true&cf_type=ISO`,
    { timeoutMs: 40_000 },
  );
  const latest = new Map();
  for (const row of body.items || []) {
    const held = latest.get(row.coa_iso);
    if (!held || row.year > held.year) latest.set(row.coa_iso, row);
  }
  const number = (value) => Number(String(value).replace(/\D/g, '')) || 0;
  const items = AFRICA_COUNTRIES.map((country) => {
    const row = latest.get(country.iso3);
    if (!row) return null;
    const refugees = number(row.refugees);
    const idps = number(row.idps);
    const total = refugees + number(row.asylum_seekers) + idps;
    if (!total) return null;
    return {
      id: `unhcr-${country.iso2}`,
      lat: country.lat,
      lon: country.lon,
      title: `${country.name} · ${total.toLocaleString('en-US')} displaced`,
      badge:
        total >= 1e6
          ? `${(total / 1e6).toFixed(1)}M`
          : `${Math.round(total / 1e3)}k`,
      kind: total >= 1e6 ? 'severe' : total >= 1e5 ? 'high' : 'present',
      weight: Math.max(4, Math.min(12, Math.log10(total) * 1.7)),
      details: [
        ['Refugees hosted', refugees.toLocaleString('en-US')],
        ['Asylum-seekers', number(row.asylum_seekers).toLocaleString('en-US')],
        ['Internally displaced', idps.toLocaleString('en-US')],
        ['Year', String(row.year)],
      ],
      url: 'https://www.unhcr.org/refugee-statistics/',
      source: 'UNHCR',
    };
  }).filter(Boolean);
  if (!items.length) throw new Error('UNHCR returned no African figures');
  return { items };
}

/** Volcanoes named in the Smithsonian weekly report are marked active. */
export async function readVolcanoActivity({ readText = fetchText } = {}) {
  const xml = await readText(
    'https://volcano.si.edu/news/WeeklyVolcanoRSS.xml',
  );
  return {
    items: parseFeed(xml, { limit: 80 }).map((item) => ({
      name: item.title.split(/\s[(-]/)[0].trim(),
      title: item.title,
      summary: item.summary,
      url: item.url,
      at: item.publishedAt,
    })),
  };
}
