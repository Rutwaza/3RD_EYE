import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FACE_EMBEDDING_LENGTH, createFaceIdentityStore } from './store.js';

async function withStore(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gev-face-store-'));
  try {
    await run(createFaceIdentityStore({ directory }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function embedding(value = 0) {
  return Array(FACE_EMBEDDING_LENGTH).fill(value);
}

test('face identity store requires consent and persists embeddings without source photos', async () => {
  await withStore(async (store) => {
    await assert.rejects(
      store.enroll({ name: 'Dev teammate', embeddings: [embedding()], consentConfirmed: false }),
      /consent/,
    );
    const enrolled = await store.enroll({
      name: 'Dev teammate',
      embeddings: [embedding(), embedding(0.01)],
      consentConfirmed: true,
    });
    assert.equal(enrolled.templateCount, 2);
    assert.deepEqual(await store.list(), [
      {
        id: enrolled.id,
        name: 'Dev teammate',
        category: 'authorised',
        note: '',
        createdAt: enrolled.createdAt,
        templateCount: 2,
      },
    ]);
  });
});

test('face matching reports possible matches only above threshold and unknown otherwise', async () => {
  await withStore(async (store) => {
    const enrolled = await store.enroll({
      name: 'Dev teammate',
      embeddings: [embedding()],
      consentConfirmed: true,
    });
    assert.deepEqual(await store.match(embedding(), 70), {
      status: 'possible-match',
      id: enrolled.id,
      name: 'Dev teammate',
      category: 'authorised',
      similarityPct: 100,
    });
    assert.equal((await store.match(embedding(0.5), 70)).status, 'unknown');
  });
});

test('identity deletion removes the persisted templates', async () => {
  await withStore(async (store) => {
    const enrolled = await store.enroll({
      name: 'Dev teammate',
      embeddings: [embedding()],
      consentConfirmed: true,
    });
    assert.equal(await store.remove(enrolled.id), true);
    assert.equal(await store.remove(enrolled.id), false);
    assert.deepEqual(await store.list(), []);
  });
});

test('face store rejects malformed vectors and duplicate names', async () => {
  await withStore(async (store) => {
    await assert.rejects(
      store.enroll({ name: 'Broken', embeddings: [[1, 2, 3]], consentConfirmed: true }),
      /template is invalid/,
    );
    await store.enroll({
      name: 'Ada',
      embeddings: [embedding()],
      consentConfirmed: true,
    });
    await assert.rejects(
      store.enroll({
        name: ' ada ',
        embeddings: [embedding()],
        consentConfirmed: true,
      }),
      /already enrolled/,
    );
  });
});

test('concurrent enrollments serialize without losing identities', async () => {
  await withStore(async (store) => {
    await Promise.all(
      ['Dev A', 'Dev B', 'Dev C'].map((name, index) =>
        store.enroll({
          name,
          embeddings: [embedding(index * 0.25)],
          consentConfirmed: true,
        }),
      ),
    );
    assert.deepEqual(
      (await store.list()).map(({ name }) => name).sort(),
      ['Dev A', 'Dev B', 'Dev C'],
    );
  });
});
