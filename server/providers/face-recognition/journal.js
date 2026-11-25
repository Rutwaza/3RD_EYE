import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const SIGHTING_LIMIT = 1_000;
export const SIGHTING_RETENTION_MS = 30 * 86_400_000;
const REVIEWS = new Set(['confirmed', 'rejected']);
const GENESIS = '0'.repeat(64);

const text = (value, limit) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .trim()
    .slice(0, limit);

/**
 * Record candidate sightings of enrolled people and an audit trail of every
 * action. People who are not enrolled are never written down.
 */
export function createFaceJournal({
  directory = process.env.GEV_FACE_IDENTITIES_DIR ||
    path.join(os.homedir(), '.gods-eye-view', 'face-identities'),
  now = Date.now,
  id = randomUUID,
} = {}) {
  const sightingFile = path.join(directory, 'sightings-v1.json');
  const auditFile = path.join(directory, 'audit-v1.jsonl');
  let sightings = null;
  let lastHash = null;
  let queue = Promise.resolve();

  const serialize = (task) => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };

  async function loadSightings() {
    if (!sightings) {
      try {
        const saved = JSON.parse(await readFile(sightingFile, 'utf8'));
        sightings = Array.isArray(saved?.sightings) ? saved.sightings : [];
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        sightings = [];
      }
    }
    const oldest = now() - SIGHTING_RETENTION_MS;
    sightings = sightings.filter((row) => row.at >= oldest);
    return sightings;
  }

  async function saveSightings(next) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${sightingFile}.${id()}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({ version: 1, sightings: next }),
      { encoding: 'utf8', mode: 0o600 },
    );
    await rename(temporary, sightingFile);
    sightings = next;
  }

  async function auditRows() {
    try {
      return (await readFile(auditFile, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  const hashOf = (row) =>
    createHash('sha256')
      .update(
        JSON.stringify([row.previous, row.at, row.action, row.subject, row.detail]),
      )
      .digest('hex');

  /** Each row seals the one before it, so a silent edit breaks the chain. */
  async function writeAudit(action, subject = '', detail = '') {
    if (lastHash === null) lastHash = (await auditRows()).at(-1)?.hash || GENESIS;
    const row = {
      at: now(),
      action: text(action, 40),
      subject: text(subject, 90),
      detail: text(detail, 160),
      previous: lastHash,
    };
    row.hash = hashOf(row);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await appendFile(auditFile, `${JSON.stringify(row)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    lastHash = row.hash;
  }

  return Object.freeze({
    audit: (action, subject, detail) =>
      serialize(() => writeAudit(action, subject, detail)),
    readAudit: (limit = 60) =>
      serialize(async () => {
        const rows = await auditRows();
        let previous = GENESIS;
        let intact = true;
        for (const row of rows) {
          if (row.previous !== previous || row.hash !== hashOf(row)) {
            intact = false;
            break;
          }
          previous = row.hash;
        }
        return {
          intact,
          total: rows.length,
          rows: rows
            .slice(-limit)
            .reverse()
            .map(({ at, action, subject, detail }) => ({
              at,
              action,
              subject,
              detail,
            })),
        };
      }),
    list: () =>
      serialize(async () => [...(await loadSightings())].reverse()),
    record: (input, identity) =>
      serialize(async () => {
        const rows = await loadSightings();
        const row = {
          id: id(),
          at: now(),
          identityId: identity.id,
          name: identity.name,
          category: identity.category,
          cameraId: text(input.cameraId, 96),
          cameraName: text(input.cameraName, 80),
          similarityPct: Math.max(
            0,
            Math.min(100, Math.round(Number(input.similarityPct) || 0)),
          ),
          votes: Math.max(0, Math.min(50, Math.round(Number(input.votes) || 0))),
          review: null,
        };
        await saveSightings([...rows, row].slice(-SIGHTING_LIMIT));
        await writeAudit('sighting', row.name, row.cameraName);
        return row;
      }),
    review: (sightingId, verdict) =>
      serialize(async () => {
        if (!REVIEWS.has(verdict))
          throw new TypeError('Review must be confirmed or rejected');
        const rows = await loadSightings();
        const row = rows.find((item) => item.id === sightingId);
        if (!row) return null;
        const updated = { ...row, review: verdict, reviewedAt: now() };
        await saveSightings(rows.map((item) => (item === row ? updated : item)));
        await writeAudit(`review-${verdict}`, row.name, row.cameraName);
        return updated;
      }),
    clear: () =>
      serialize(async () => {
        const count = (await loadSightings()).length;
        await saveSightings([]);
        await writeAudit('sightings-cleared', '', `${count} rows`);
        return count;
      }),
    forget: (identityId) =>
      serialize(async () => {
        const rows = await loadSightings();
        const next = rows.filter((row) => row.identityId !== identityId);
        if (next.length !== rows.length) await saveSightings(next);
      }),
  });
}
