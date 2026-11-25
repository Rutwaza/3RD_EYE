import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { createFaceIdentityStore, FACE_EMBEDDING_LENGTH } from './face-recognition/store.js';
import { createFaceRecognitionMiddleware } from './face-recognition.js';
import { createFaceJournal } from './face-recognition/journal.js';

function request(method, url, body, { address = '127.0.0.1', origin = 'http://localhost:4173' } = {}) {
  const bytes = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const input = Readable.from(bytes);
  Object.assign(input, {
    method,
    url,
    headers: { host: 'localhost:4173', origin },
    socket: { remoteAddress: address },
  });
  return input;
}

async function invoke(middleware, input) {
  const response = {
    status: 0,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
  await middleware(input, response);
  return {
    status: response.status,
    headers: response.headers,
    body:
      response.headers['Content-Type'] === 'application/json'
        ? JSON.parse(response.body)
        : response.body,
  };
}

const embedding = (value = 0) => Array(FACE_EMBEDDING_LENGTH).fill(value);

test('Face Recognition middleware is loopback-only and rejects cross-origin calls', async () => {
  const middleware = createFaceRecognitionMiddleware({
    store: createFaceIdentityStore({ directory: path.join(os.tmpdir(), 'gev-face-api-unused') }),
  });
  assert.equal(
    (await invoke(middleware, request('GET', '/status', undefined, { address: '192.168.1.5' }))).status,
    403,
  );
  assert.equal(
    (await invoke(middleware, request('POST', '/identities', {}, { origin: 'https://attacker.example' }))).status,
    403,
  );
});

test('Face Recognition API enrolls, matches, lists, and deletes identities locally', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gev-face-api-'));
  try {
    const middleware = createFaceRecognitionMiddleware({
      store: createFaceIdentityStore({ directory }),
      journal: createFaceJournal({ directory }),
    });
    const enrolled = await invoke(
      middleware,
      request('POST', '/identities', {
        name: 'Dev teammate',
        embeddings: [embedding(), embedding(0.01)],
        consentConfirmed: true,
      }),
    );
    assert.equal(enrolled.status, 201);
    assert.equal(enrolled.body.identity.templateCount, 2);

    const matched = await invoke(
      middleware,
      request('POST', '/match', {
        embeddings: [embedding()],
        thresholdPct: 70,
      }),
    );
    assert.equal(matched.body.results[0].status, 'possible-match');
    assert.equal(matched.body.results[0].name, 'Dev teammate');

    const listed = await invoke(middleware, request('GET', '/identities'));
    assert.equal(listed.body.identities.length, 1);
    assert.equal(Object.hasOwn(listed.body.identities[0], 'embeddings'), false);

    const person = enrolled.body.identity;
    const sighting = await invoke(
      middleware,
      request('POST', '/sightings', {
        identityId: person.id,
        cameraName: 'Gate',
        similarityPct: 91,
        votes: 3,
      }),
    );
    assert.equal(sighting.status, 201);
    assert.equal(
      (
        await invoke(
          middleware,
          request('POST', '/sightings', {
            identityId: '00000000-0000-0000-0000-000000000000',
          }),
        )
      ).status,
      404,
      'a person who is not enrolled is never recorded',
    );
    const reviewed = await invoke(
      middleware,
      request('POST', `/sightings/${sighting.body.sighting.id}/review`, {
        verdict: 'confirmed',
      }),
    );
    assert.equal(reviewed.body.sighting.review, 'confirmed');

    const removed = await invoke(
      middleware,
      request('DELETE', `/identities/${enrolled.body.identity.id}`),
    );
    assert.equal(removed.body.removed, true);
    assert.equal(
      (await invoke(middleware, request('GET', '/sightings'))).body.sightings
        .length,
      0,
      'deleting a person deletes their sightings',
    );
    const audit = await invoke(middleware, request('GET', '/audit'));
    assert.equal(audit.body.intact, true);
    assert.deepEqual(
      audit.body.rows.map(({ action }) => action),
      ['deleted', 'review-confirmed', 'sighting', 'enrolled'],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Face Recognition model route serves only the small allowlisted model set', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gev-face-models-'));
  try {
    await writeFile(path.join(directory, 'blazeface.json'), '{"weightsManifest":[{"paths":["blazeface.bin"]}]}');
    await writeFile(path.join(directory, 'blazeface.bin'), 'weights');
    const middleware = createFaceRecognitionMiddleware({ modelsDirectory: directory });
    const model = await invoke(middleware, request('GET', '/models/blazeface.json'));
    assert.equal(model.status, 200);
    assert.deepEqual(
      model.body.weightsManifest[0].paths,
      ['blazeface.weights'],
      'weights avoid the .bin name that download managers seize',
    );
    assert.equal(
      (await invoke(middleware, request('GET', '/models/blazeface.weights'))).status,
      200,
    );
    assert.equal(
      (await invoke(middleware, request('GET', '/models/unknown.weights'))).status,
      404,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});