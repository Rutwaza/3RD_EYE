import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createFaceIdentityStore } from './face-recognition/store.js';

const MAX_REQUEST_BYTES = 1_500_000;
const MODEL_FILES = new Set([
  'blazeface.json',
  'blazeface.bin',
  'facemesh.json',
  'facemesh.bin',
  'faceres.json',
  'faceres.bin',
]);

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
    const modelMatch = /^\/models\/([a-z0-9-]+\.(?:json|bin))$/.exec(
      url.pathname,
    );
    if (modelMatch && method === 'GET') {
      const [, filename] = modelMatch;
      if (!MODEL_FILES.has(filename)) {
        respond(response, 404, { error: 'Model not found' });
        return;
      }
      try {
        const body = await readFile(path.join(modelRoot, filename));
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
          model: 'Human FaceRes',
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
        const removed = await store.remove(identityPath[1]);
        respond(response, removed ? 200 : 404, { removed });
      } catch {
        respond(response, 503, { error: 'Local identity store is unavailable' });
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
