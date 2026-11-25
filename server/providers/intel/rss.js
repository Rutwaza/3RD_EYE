const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  eacute: 'é',
  egrave: 'è',
};

export function decodeEntities(text) {
  return String(text).replace(
    /&(?:#x([0-9a-f]{1,6})|#(\d{1,7})|([a-z]+));/gi,
    (match, hex, decimal, name) => {
      if (name) return ENTITIES[name.toLowerCase()] ?? match;
      const point = hex ? parseInt(hex, 16) : Number(decimal);
      return point > 31 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : ' ';
    },
  );
}

/** Feed markup to plain text. Output is always rendered with textContent. */
export function plainText(markup, limit = 320) {
  const raw = String(markup || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const text = decodeEntities(
    decodeEntities(raw)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function field(block, names) {
  for (const name of names) {
    const match = new RegExp(
      `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`,
      'i',
    ).exec(block);
    if (match?.[1]?.trim()) return match[1];
  }
  return '';
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(decodeEntities(String(value || '').trim()));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

function link(block) {
  const text = plainText(field(block, ['link']), 2048);
  if (text) return safeHttpUrl(text);
  const atom =
    /<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(
      block,
    ) || /<link\b[^>]*href=["']([^"']+)["']/i.exec(block);
  return safeHttpUrl(atom?.[1]);
}

function image(block) {
  const match =
    /<media:(?:content|thumbnail)\b[^>]*url=["']([^"']+)["']/i.exec(block) ||
    /<enclosure\b(?=[^>]*type=["']image)[^>]*url=["']([^"']+)["']/i.exec(
      block,
    ) ||
    /(?:<|&lt;)img\b[^>]*?src=(?:["']|&quot;)([^"'&]+)/i.exec(block);
  const url = safeHttpUrl(match?.[1]);
  return url.startsWith('https:') ? url : '';
}

/** Parse RSS 2.0, RDF and Atom items. Malformed entries are skipped. */
export function parseFeed(xml, { limit = 40 } = {}) {
  const items = [];
  const pattern = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  for (const [, , block] of String(xml).matchAll(pattern)) {
    const title = plainText(field(block, ['title']), 240);
    const url = link(block);
    if (!title || !url) continue;
    const date = plainText(
      field(block, ['pubDate', 'published', 'updated', 'dc:date']),
      80,
    );
    const at = Date.parse(date);
    items.push({
      title,
      url,
      summary: plainText(
        field(block, ['description', 'summary', 'content:encoded']),
      ),
      publisher: plainText(field(block, ['source']), 60),
      publishedAt: Number.isFinite(at) ? at : null,
      image: image(block),
    });
    if (items.length >= limit) break;
  }
  return items;
}
