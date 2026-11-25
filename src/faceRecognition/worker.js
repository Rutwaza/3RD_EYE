import Human from '@vladmandic/human';

const API_ROOT = '/api/face-recognition';
const MIN_FACE_EDGE_PX = 224;
const MIN_FACE_SCORE = 0.7;
const MIN_BOX_SCORE = 0.7;
let human = null;
let loading = null;

async function ensureHuman() {
  if (human) return human;
  if (loading) return loading;
  loading = (async () => {
    const instance = new Human({
      backend: 'webgl',
      modelBasePath: `${API_ROOT}/models/`,
      face: {
        enabled: true,
        detector: {
          enabled: true,
          maxDetected: 8,
          rotation: true,
          minConfidence: 0.6,
        },
        mesh: { enabled: true },
        description: { enabled: true },
        attention: { enabled: false },
        iris: { enabled: false },
        emotion: { enabled: false },
        gear: { enabled: false },
        antispoof: { enabled: false },
        liveness: { enabled: false },
      },
      body: { enabled: false },
      hand: { enabled: false },
      object: { enabled: false },
      gesture: { enabled: false },
    });
    await instance.load();
    await instance.warmup();
    human = instance;
    return instance;
  })();
  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

async function api(path, body) {
  const response = await fetch(`${API_ROOT}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || 'Local face service failed');
    error.duplicate = payload.duplicate || null;
    throw error;
  }
  return payload;
}

async function embedEnrollmentImages(images) {
  const instance = await ensureHuman();
  if (!Array.isArray(images) || images.length < 1 || images.length > 8)
    throw new Error('Choose between 1 and 8 reference photos');
  const embeddings = [];
  for (const [index, image] of images.entries()) {
    try {
      const result = await instance.detect(image);
      if (result.face.length !== 1 || !result.face[0].embedding)
        throw new Error('Each reference photo must contain exactly one clear face');
      const quality = faceQuality(result.face[0]);
      if (!quality.usable)
        throw new Error(`Reference photo ${index + 1}: ${quality.reason}`);
      embeddings.push(result.face[0].embedding);
    } finally {
      image.close?.();
    }
  }
  return embeddings;
}

function faceQuality(face) {
  const box = Array.isArray(face?.box) ? face.box.map(Number) : [];
  const edge = Math.min(box[2] || 0, box[3] || 0);
  if (!Number.isFinite(edge) || edge < MIN_FACE_EDGE_PX)
    return {
      usable: false,
      edgePx: Number.isFinite(edge) ? Math.max(0, Math.round(edge)) : 0,
      reason: `face is too small (need at least ${MIN_FACE_EDGE_PX}px)`,
    };
  const boxScore = Number(face.boxScore);
  const faceScore = Number(face.faceScore);
  if (
    !Number.isFinite(boxScore) ||
    boxScore < MIN_BOX_SCORE ||
    !Number.isFinite(faceScore) ||
    faceScore < MIN_FACE_SCORE
  )
    return {
      usable: false,
      edgePx: Math.round(edge),
      reason: 'face detection confidence is too low',
    };
  return { usable: true, edgePx: Math.round(edge), reason: '' };
}

async function handleMessage(message) {
  if (message.type === 'initialize') {
    const [instance, status] = await Promise.all([
      ensureHuman(),
      api('/status'),
    ]);
    return {
      ready: true,
      backend: instance.tf?.getBackend?.() || 'webgl',
      identityCount: status.identities,
    };
  }
  if (message.type === 'enroll') {
    const embeddings = await embedEnrollmentImages(message.images);
    return api('/identities', {
      name: message.name,
      consentConfirmed: message.consentConfirmed === true,
      allowPossibleDuplicate: message.allowPossibleDuplicate === true,
      embeddings,
    });
  }
  if (message.type === 'analyze') {
    const instance = await ensureHuman();
    try {
      const result = await instance.detect(message.image);
      const faces = result.face.slice(0, 8).map((face) => ({
        face,
        quality: faceQuality(face),
      }));
      const candidates = faces
        .map(({ face, quality }, index) => ({ face, quality, index }))
        .filter(({ face, quality }) => quality.usable && Array.isArray(face.embedding));
      if (!candidates.length)
        return {
          results: faces.map(({ face, quality }) => ({
            status: 'low-quality',
            qualityReason: quality.reason || 'face descriptor is unavailable',
            faceEdgePx: quality.edgePx,
            box: Array.isArray(face.box) ? face.box.map(Number) : null,
          })),
        };
      const matches = await api('/match', {
        embeddings: candidates.map(({ face }) => face.embedding),
        thresholdPct: message.thresholdPct,
      });
      const matchByFace = new Map(
        candidates.map(({ index }, candidateIndex) => [index, matches.results[candidateIndex]]),
      );
      return {
        results: faces.map(({ face, quality }, index) => ({
          ...(matchByFace.get(index) || {
            status: 'low-quality',
            qualityReason: quality.reason || 'face descriptor is unavailable',
          }),
          faceEdgePx: quality.edgePx,
          box: Array.isArray(face.box) ? face.box.map(Number) : null,
        })),
      };
    } finally {
      message.image.close?.();
    }
  }
  throw new Error('Unknown face-analysis operation');
}

self.addEventListener('message', async (event) => {
  const { requestId, ...message } = event.data || {};
  try {
    const result = await handleMessage(message);
    self.postMessage({ requestId, ok: true, result });
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error?.message || 'Face analysis failed',
      duplicate: error?.duplicate || null,
    });
  }
});
