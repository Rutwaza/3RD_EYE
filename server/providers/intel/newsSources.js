/** A publisher's own recent items, read through Google News when it has no feed. */
const viaGoogleNews = (site, window = '2d') =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`site:${site} when:${window}`)}&hl=en-US&gl=US&ceid=US:en`;

const source = (id, name, url, options = {}) =>
  Object.freeze({
    id,
    name,
    url,
    desk: 'world',
    trust: 3,
    category: null,
    aggregated: url.startsWith('https://news.google.com/'),
    ...options,
  });

/**
 * Publishers the desk reads. `trust` is an editorial weight from 1 to 5 used in
 * ranking; it is not a claim that any single report is true. `category` is the
 * desk a specialist feed belongs to when its text does not say otherwise.
 */
export const NEWS_SOURCES = Object.freeze([
  // Rwanda and East Africa
  source('igihe', 'IGIHE', viaGoogleNews('igihe.com', '3d'), {
    desk: 'east-africa',
    trust: 4,
    home: 'RW',
  }),
  source('newtimes', 'The New Times', viaGoogleNews('newtimes.co.rw', '3d'), {
    desk: 'east-africa',
    trust: 4,
    home: 'RW',
  }),
  source('ktpress', 'KT Press', 'https://www.ktpress.rw/feed/', {
    desk: 'east-africa',
    trust: 4,
    home: 'RW',
  }),
  source('umuseke', 'Umuseke', 'https://umuseke.rw/feed/', {
    desk: 'east-africa',
    trust: 3,
    home: 'RW',
  }),
  source(
    'eastafrican',
    'The EastAfrican',
    viaGoogleNews('theeastafrican.co.ke', '3d'),
    {
      desk: 'east-africa',
      trust: 4,
    },
  ),
  source('nation', 'Nation Kenya', 'https://nation.africa/kenya/rss.xml', {
    desk: 'east-africa',
    trust: 4,
    home: 'KE',
  }),
  source('monitor', 'Daily Monitor', viaGoogleNews('monitor.co.ug', '3d'), {
    desk: 'east-africa',
    trust: 4,
    home: 'UG',
  }),
  source('citizen', 'The Citizen', viaGoogleNews('thecitizen.co.tz', '3d'), {
    desk: 'east-africa',
    trust: 4,
    home: 'TZ',
  }),
  source('actualite', 'Actualite.cd', viaGoogleNews('actualite.cd', '3d'), {
    desk: 'east-africa',
    trust: 3,
    home: 'CD',
  }),
  source(
    'allafrica-east',
    'AllAfrica · East',
    'https://allafrica.com/tools/headlines/rdf/eastafrica/headlines.rdf',
    { desk: 'east-africa', trust: 3 },
  ),
  // Africa
  source(
    'bbc-africa',
    'BBC Africa',
    'https://feeds.bbci.co.uk/news/world/africa/rss.xml',
    {
      desk: 'africa',
      trust: 5,
      family: 'bbc',
    },
  ),
  source('rfi-africa', 'RFI Africa', 'https://www.rfi.fr/en/africa/rss', {
    desk: 'africa',
    trust: 4,
  }),
  source(
    'f24-africa',
    'France 24 Africa',
    'https://www.france24.com/en/africa/rss',
    {
      desk: 'africa',
      trust: 4,
    },
  ),
  source('dw-africa', 'DW Africa', 'https://rss.dw.com/rdf/rss-en-africa', {
    desk: 'africa',
    trust: 4,
  }),
  source('africanews', 'Africanews', 'https://www.africanews.com/feed/rss', {
    desk: 'africa',
    trust: 3,
  }),
  source(
    'allafrica',
    'AllAfrica',
    'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf',
    { desk: 'africa', trust: 3 },
  ),
  // World
  source('reuters', 'Reuters', viaGoogleNews('reuters.com', '1d'), {
    trust: 5,
  }),
  source('ap', 'AP News', viaGoogleNews('apnews.com', '1d'), { trust: 5 }),
  source('bbc', 'BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml', {
    trust: 5,
    family: 'bbc',
  }),
  source('cnn', 'CNN', viaGoogleNews('cnn.com', '1d'), { trust: 4 }),
  source(
    'aljazeera',
    'Al Jazeera',
    'https://www.aljazeera.com/xml/rss/all.xml',
    {
      trust: 4,
    },
  ),
  source(
    'nyt',
    'New York Times',
    'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
    {
      trust: 5,
    },
  ),
  source(
    'guardian',
    'The Guardian',
    viaGoogleNews('theguardian.com/world', '1d'),
    {
      trust: 4,
    },
  ),
  source('npr', 'NPR World', 'https://feeds.npr.org/1004/rss.xml', {
    trust: 4,
  }),
  source(
    'un',
    'UN News',
    'https://news.un.org/feed/subscribe/en/news/all/rss.xml',
    { trust: 5 },
  ),
  // Conflict and geopolitics
  source(
    'defensenews',
    'Defense News',
    'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml',
    { category: 'conflict', trust: 4 },
  ),
  source(
    'isw',
    'Institute for the Study of War',
    viaGoogleNews('understandingwar.org', '4d'),
    {
      category: 'conflict',
      trust: 4,
    },
  ),
  source('crisisgroup', 'Crisis Group', 'https://www.crisisgroup.org/rss.xml', {
    category: 'geopolitics',
    trust: 4,
  }),
  source('foreignpolicy', 'Foreign Policy', 'https://foreignpolicy.com/feed/', {
    category: 'geopolitics',
    trust: 4,
  }),
  // Economy
  source(
    'cnbc',
    'CNBC World',
    'https://www.cnbc.com/id/100727362/device/rss/rss.html',
    {
      category: 'economy',
      trust: 4,
    },
  ),
  source(
    'bbc-business',
    'BBC Business',
    'https://feeds.bbci.co.uk/news/business/rss.xml',
    {
      category: 'economy',
      trust: 5,
      family: 'bbc',
    },
  ),
  source('bloomberg', 'Bloomberg', viaGoogleNews('bloomberg.com', '1d'), {
    category: 'economy',
    trust: 5,
  }),
  // Technology
  source('techcrunch', 'TechCrunch', 'https://techcrunch.com/feed/', {
    category: 'technology',
    trust: 4,
  }),
  source(
    'bbc-tech',
    'BBC Technology',
    'https://feeds.bbci.co.uk/news/technology/rss.xml',
    {
      category: 'technology',
      trust: 5,
      family: 'bbc',
    },
  ),
  source(
    'ars',
    'Ars Technica',
    'https://feeds.arstechnica.com/arstechnica/index',
    {
      category: 'technology',
      trust: 4,
    },
  ),
]);

/** Newsroom accounts read when an official X API token is configured. */
export const X_ACCOUNTS = Object.freeze([
  'Reuters',
  'AP',
  'BBCBreaking',
  'cnnbrk',
  'AJEnglish',
  'AFP',
  'IGIHE',
  'NewTimesRwanda',
  'UrugwiroVillage',
  'RwandaGov',
  'UN',
  'CrisisGroup',
]);

/** Public live streams. Nothing loads until the operator opens a channel. */
export const LIVE_CHANNELS = Object.freeze([
  {
    id: 'aje',
    name: 'Al Jazeera English',
    channel: 'UCNye-wNBqNL5ZzHSJj3l8Bg',
  },
  { id: 'f24', name: 'France 24 English', channel: 'UCQfwfsi5VrQ8yKZ-UWmAEFg' },
  { id: 'dw', name: 'DW News', channel: 'UCknLrEdhRCp1aegoMqRaCZg' },
  { id: 'sky', name: 'Sky News', channel: 'UCoMdktPbSTixAyNGwb-UYkQ' },
  { id: 'trt', name: 'TRT World', channel: 'UC7fWeaHhqgM4Ry-RMpM2YYw' },
  { id: 'africanews', name: 'Africanews', channel: 'UC1_E8NeF5QHY2dtdLRBCCLA' },
]);
