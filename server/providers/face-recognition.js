import { createRequire } from 'node:module';
import path from 'node:path';
import { createFaceIdentityStore } from './face-recognition/store.js';
import { readModelFile } from './face-recognition/models.js';
import { createFaceJournal } from './face-recognition/journal.js';

const MAX_REQUEST_BYTES = 1_500_000;

function isLoopback(address = '') {
  const normalized = String(address).toLowerCase().replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new RangeError('Request is too large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new TypeError('Request JSON is invalid');
  }
}

function respond(response, status, payload, contentType = 'application/json') {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(
    contentType === 'application/json' && !Buffer.isBuffer(payload)
      ? JSON.stringify(payload)
      : payload,
  );
}

/** Loopback-only Face Recognition API. It never accepts or fetches stream URLs. */
export function createFaceRecognitionMiddleware({
  store = createFaceIdentityStore(),
  journal = createFaceJournal(),
  modelsDirectory,
} = {}) {
  const humanEntry = createRequire(import.meta.url).resolve(
    '@vladmandic/human',
  );
  const modelRoot =
    modelsDirectory || path.resolve(path.dirname(humanEntry), '../models');

  return async function faceRecognitionMiddleware(request, response) {
    if (!isLoopback(request.socket?.remoteAddress)) {
      respond(response, 403, { error: 'Face service is local-only' });
      return;
    }
    const origin = request.headers?.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== request.headers.host) {
          respond(response, 403, { error: 'Cross-origin access is disabled' });
          return;
        }
      } catch {
        respond(response, 403, { error: 'Request origin is invalid' });
        return;
      }
    }

    const url = new URL(request.url || '/', 'http://localhost');
    const method = String(request.method || 'GET').toUpperCase();
    const modelMatch = /^\/models\/([a-z0-9-]+\.(?:json|weights))$/.exec(
      url.pathname,
    );
    if (modelMatch && method === 'GET') {
      const [, filename] = modelMatch;
      try {
        const body = await readModelFile(modelRoot, filename);
        if (!body) {
          respond(response, 404, { error: 'Model not found' });
          return;
        }
        respond(
          response,
          200,
          body,
          filename.endsWith('.json')
            ? 'application/json'
            : 'application/octet-stream',
        );
      } catch {
        respond(response, 503, { error: 'Local model files are unavailable' });
      }
      return;
    }

    if (url.pathname === '/status' && method === 'GET') {
      try {
        const identities = await store.list();
        respond(response, 200, {
          available: true,
          identities: identities.length,
          model: 'CenterNet people · BlazeFace · FaceRes · liveness',
          storage: 'private local folder',
        });
      } catch {
        respond(response, 503, { available: false, error: 'Local identity store is unavailable' });
      }
      return;
    }

    if (url.pathname === '/identities' && method === 'GET') {
      try {
        respond(response, 200, { identities: await store.list() });
      } catch {
        respond(response, 503, { error: 'Local identity store is unavailable' });
      }
      return;
    }

    if (url.pathname === '/identities' && method === 'POST') {
      try {
        const body = await readJson(request);
        const identity = await store.enroll(body);
        await journal.audit('enrolled', identity.name, identity.category);
        respond(response, 201, { identity });
      } catch (error) {
        if (error?.duplicate) {
          respond(response, 409, {
            error: error.message || 'This face may already be enrolled',
            duplicate: error.duplicate,
          });
          return;
        }
        const status = error instanceof RangeError ? 413 : 400;
        respond(response, status, { error: error.message || 'Enrollment failed' });
      }
      return;
    }

    if (url.pathname === '/match' && method === 'POST') {
      try {
        const body = await readJson(request);
        const embeddings = body.embeddings;
        if (!Array.isArray(embeddings) || embeddings.length > 8)
          throw new TypeError('At most 8 faces can be matched per frame');
        const thresholdPct = Number(body.thresholdPct);
        const results = await Promise.all(
          embeddings.map((embedding) => store.match(embedding, thresholdPct)),
        );
        respond(response, 200, { results });
      } catch (error) {
        const status = error instanceof RangeError ? 413 : 400;
        respond(response, status, { error: error.message || 'Matching failed' });
      }
      return;
    }

    const identityPath = /^\/identities\/([a-f0-9-]{36})$/i.exec(url.pathname);
    if (identityPath && method === 'DELETE') {
      try {
        const person = (await store.list()).find(
          ({ id }) => id === identityPath[1],
        );
        const removed = await store.remove(identityPath[1]);
        if (removed) {
          await journal.forget(identityPath[1]);
          await journal.audit('deleted', person?.name);
        }
        respond(response, removed ? 200 : 404, { removed });
      } catch {
        respond(response, 503, { error: 'Local identity store is unavailable' });
      }
      return;
    }

    if (url.pathname === '/sightings') {
      try {
        if (method === 'GET') {
          respond(response, 200, { sightings: (await journal.list()).slice(0, 120) });
          return;
        }
        if (method === 'DELETE') {
          respond(response, 200, { cleared: await journal.clear() });
          return;
        }
        if (method === 'POST') {
          const body = await readJson(request);
          const identity = (await store.list()).find(
            ({ id }) => id === body.identityId,
          );
          if (!identity) {
            respond(response, 404, { error: 'That person is not enrolled' });
            return;
          }
          respond(response, 201, {
            sighting: await journal.record(body, identity),
          });
          return;
        }
      } catch (error) {
        respond(response, error instanceof TypeError ? 400 : 503, {
          error: error instanceof TypeError ? error.message : 'Sightings are unavailable',
        });
        return;
      }
    }

    const reviewPath = /^\/sightings\/([a-f0-9-]{36})\/review$/i.exec(url.pathname);
    if (reviewPath && method === 'POST') {
      try {
        const { verdict } = await readJson(request);
        const sighting = await journal.review(reviewPath[1], verdict);
        respond(response, sighting ? 200 : 404, sighting ? { sighting } : { error: 'Sighting not found' });
      } catch (error) {
        respond(response, 400, { error: error.message || 'Review failed' });
      }
      return;
    }

    if (url.pathname === '/audit' && method === 'GET') {
      try {
        respond(response, 200, await journal.readAudit());
      } catch {
        respond(response, 503, { error: 'Audit trail is unavailable' });
      }
      return;
    }

    if (url.pathname === '/session' && method === 'POST') {
      try {
        const { action, cameraName } = await readJson(request);
        if (!['started', 'stopped'].includes(action))
          throw new TypeError('Unknown session action');
        await journal.audit(`analysis-${action}`, '', cameraName);
        respond(response, 200, { recorded: true });
      } catch (error) {
        respond(response, 400, { error: error.message || 'Session was not recorded' });
      }
      return;
    }

    respond(response, 404, { error: 'Face Recognition endpoint not found' });
  };
}

/** Vite middleware plugin for local face enrollment and matching. */
export function faceRecognitionProxy(options) {
  const middleware = createFaceRecognitionMiddleware(options);
  return {
    name: 'gev-face-recognition-local',
    configureServer(server) {
      server.middlewares.use('/api/face-recognition', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/face-recognition', middleware);
    },
  };
}
