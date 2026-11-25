import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const FACE_EMBEDDING_LENGTH = 1024;
export const FACE_IDENTITY_LIMIT = 256;
export const FACE_TEMPLATES_PER_IDENTITY_LIMIT = 8;
export const FACE_SIMILARITY_THRESHOLD_DEFAULT = 70;
export const FACE_POSSIBLE_DUPLICATE_THRESHOLD = 90;
/** A best score this close to another person's is not a usable answer. */
export const FACE_AMBIGUITY_MARGIN = 4;
export const FACE_CATEGORIES = Object.freeze(['authorised', 'visitor', 'poi']);

function validateEmbedding(value) {
  if (
    !Array.isArray(value) ||
    value.length !== FACE_EMBEDDING_LENGTH ||
    !value.every((entry) => Number.isFinite(entry) && Math.abs(entry) <= 10)
  )
    throw new TypeError('Face template is invalid');
  return value.map((entry) => Math.fround(entry));
}

function normalizeIdentity(identity) {
  if (!identity || typeof identity !== 'object')
    throw new TypeError('Identity record is invalid');
  const id = String(identity.id || '');
  const name = String(identity.name || '').trim();
  const embeddings = identity.embeddings;
  if (!/^[a-f0-9-]{36}$/i.test(id))
    throw new TypeError('Identity id is invalid');
  if (!name || name.length > 80) throw new TypeError('Identity name is invalid');
  if (
    !Array.isArray(embeddings) ||
    embeddings.length < 1 ||
    embeddings.length > FACE_TEMPLATES_PER_IDENTITY_LIMIT
  )
    throw new TypeError('Identity needs 1 to 8 reference templates');
  return {
    id,
    name,
    category: FACE_CATEGORIES.includes(identity.category)
      ? identity.category
      : 'authorised',
    note: String(identity.note || '').trim().slice(0, 160),
    createdAt: String(identity.createdAt || new Date().toISOString()),
    consentConfirmedAt: String(
      identity.consentConfirmedAt || identity.createdAt || new Date().toISOString(),
    ),
    embeddings: embeddings.map(validateEmbedding),
  };
}

function faceSimilarity(first, second) {
  let squaredDistance = 0;
  for (let index = 0; index < FACE_EMBEDDING_LENGTH; index += 1) {
    const delta = first[index] - second[index];
    squaredDistance += delta * delta;
  }
  const distance = Math.round(100 * 25 * squaredDistance) / 100;
  const normalized = (1 - Math.sqrt(distance) / 100 - 0.2) / (0.8 - 0.2);
  return Math.round(100 * Math.max(0, Math.min(1, normalized)));
}

function possibleDuplicateFor(embeddings, identity) {
  const bestScores = embeddings
    .map((embedding) =>
      Math.max(...identity.embeddings.map((template) => faceSimilarity(embedding, template))),
    )
    .sort((first, second) => second - first)
    .slice(0, 2);
  const similarityPct = Math.round(
    bestScores.reduce((sum, score) => sum + score, 0) / bestScores.length,
  );
  return {
    id: identity.id,
    name: identity.name,
    similarityPct,
  };
}

/** Private, local-only identity/template file store. Raw enrollment photos never enter it. */
export function createFaceIdentityStore({
  directory = process.env.GEV_FACE_IDENTITIES_DIR ||
    path.join(os.homedir(), '.gods-eye-view', 'face-identities'),
  fs = { mkdir, readFile, rename, writeFile },
  now = () => new Date().toISOString(),
  id = randomUUID,
} = {}) {
  const file = path.join(directory, 'identities-v1.json');
  let records = null;
  let mutationQueue = Promise.resolve();

  async function load() {
    if (records) return records;
    try {
      const stored = JSON.parse(await fs.readFile(file, 'utf8'));
      if (stored?.version !== 1 || !Array.isArray(stored.identities))
        throw new TypeError('Identity store version is invalid');
      records = stored.identities.map(normalizeIdentity);
      if (records.length > FACE_IDENTITY_LIMIT)
        throw new TypeError('Identity store exceeds its configured limit');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      records = [];
    }
    return records;
  }

  async function persist(next) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${id()}.tmp`;
    await fs.writeFile(
      temporary,
      JSON.stringify({ version: 1, identities: next }),
      { encoding: 'utf8', mode: 0o600 },
    );
    await fs.rename(temporary, file);
  }

  function serializeMutation(operation) {
    const result = mutationQueue.then(operation);
    mutationQueue = result.catch(() => {});
    return result;
  }

  async function commit(next) {
    await persist(next);
    records = next;
  }

  return Object.freeze({
    async list() {
      const rows = await load();
      return rows.map(({ id: identityId, name, category, note, createdAt, embeddings }) => ({
        id: identityId,
        name,
        category,
        note,
        createdAt,
        templateCount: embeddings.length,
      }));
    },
    async match(embedding, thresholdPct = FACE_SIMILARITY_THRESHOLD_DEFAULT) {
      const candidate = validateEmbedding(embedding);
      const requestedThreshold = Number(thresholdPct);
      const threshold = Number.isFinite(requestedThreshold)
        ? Math.max(50, Math.min(95, requestedThreshold))
        : FACE_SIMILARITY_THRESHOLD_DEFAULT;
      const rows = await load();
      const ranked = rows
        .map((row) => {
          // Two agreeing templates count for more than one lucky one.
          const scores = row.embeddings
            .map((template) => faceSimilarity(candidate, template))
            .sort((first, second) => second - first)
            .slice(0, 2);
          return {
            id: row.id,
            name: row.name,
            category: row.category,
            similarityPct: Math.round(
              scores.reduce((sum, score) => sum + score, 0) / scores.length,
            ),
          };
        })
        .sort((first, second) => second.similarityPct - first.similarityPct);
      const [best, second] = ranked;
      if (!best || best.similarityPct < threshold)
        return { status: 'unknown', similarityPct: best?.similarityPct ?? 0 };
      if (second && best.similarityPct - second.similarityPct < FACE_AMBIGUITY_MARGIN)
        return { status: 'ambiguous', similarityPct: best.similarityPct };
      return { status: 'possible-match', ...best };
    },
    async enroll({
      name: candidateName,
      embeddings,
      category = 'authorised',
      note = '',
      consentConfirmed,
      allowPossibleDuplicate = false,
    }) {
      return serializeMutation(async () => {
        const rows = await load();
        if (consentConfirmed !== true)
          throw new TypeError('Explicit enrollment consent is required');
        if (!FACE_CATEGORIES.includes(category))
          throw new TypeError('Choose a valid category');
        if (rows.length >= FACE_IDENTITY_LIMIT)
          throw new TypeError(`Maximum ${FACE_IDENTITY_LIMIT} identities reached`);
        const name = String(candidateName || '').trim();
        if (!name || name.length > 80)
          throw new TypeError('Display name must be 1 to 80 characters');
        if (rows.some((row) => row.name.toLowerCase() === name.toLowerCase()))
          throw new TypeError('That display name is already enrolled');
        if (!Array.isArray(embeddings) || embeddings.length < 1 || embeddings.length > FACE_TEMPLATES_PER_IDENTITY_LIMIT)
          throw new TypeError('Identity needs 1 to 8 reference templates');
        const templates = embeddings.map(validateEmbedding);
        const possibleDuplicate = rows
          .map((identity) => possibleDuplicateFor(templates, identity))
          .sort((first, second) => second.similarityPct - first.similarityPct)[0];
        if (
          possibleDuplicate?.similarityPct >= FACE_POSSIBLE_DUPLICATE_THRESHOLD &&
          allowPossibleDuplicate !== true
        ) {
          const error = new Error('This face may already be enrolled');
          error.duplicate = possibleDuplicate;
          throw error;
        }
        const createdAt = now();
        const record = normalizeIdentity({
          id: id(),
          name,
          category,
          note,
          createdAt,
          consentConfirmedAt: createdAt,
          embeddings: templates,
        });
        await commit([...rows, record]);
        return {
          id: record.id,
          name: record.name,
          category: record.category,
          createdAt: record.createdAt,
          templateCount: record.embeddings.length,
        };
      });
    },
    async remove(identityId) {
      return serializeMutation(async () => {
        const rows = await load();
        const next = rows.filter((row) => row.id !== identityId);
        if (next.length === rows.length) return false;
        await commit(next);
        return true;
      });
    },
  });
}
