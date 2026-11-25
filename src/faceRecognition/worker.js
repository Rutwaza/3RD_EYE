import Human from '@vladmandic/human';
import {
  ENROLL_MIN_FACE_EDGE_PX,
  assessFace,
  containment,
  createTracker,
  headRegion,
  iou,
  mergePeople,
  peopleViews,
  sharpnessOf,
} from './tracker.js';

const API_ROOT = '/api/face-recognition';
const MAX_PEOPLE = 8;
const CROP_WIDTH = 512;
const PERSON_CONFIDENCE = 0.35;
const PEOPLE_INPUT = 512;
let frameNumber = 0;
const tracker = createTracker();
let engines = null;
let loading = null;

const off = { enabled: false };
const modelBasePath = `${API_ROOT}/models/`;
const base = {
  backend: 'webgl',
  modelBasePath,
  cacheSensitivity: 0,
  // The library's filter stage can hand back the previous image when input
  // sizes change between calls, so it must stay off.
  filter: { enabled: false, equalization: false, flip: false },
  hand: off,
  gesture: off,
  segmentation: off,
};

const faceConfig = {
  enabled: true,
  detector: {
    enabled: true,
    maxDetected: 4,
    rotation: true,
    minConfidence: 0.4,
    skipFrames: 0,
    skipTime: 0,
  },
  mesh: { enabled: true },
  description: { enabled: true, skipFrames: 0, skipTime: 0 },
  antispoof: { enabled: true, skipFrames: 0, skipTime: 0 },
  liveness: { enabled: true, skipFrames: 0, skipTime: 0 },
  attention: off,
  iris: off,
  emotion: off,
  gear: off,
};
const objectConfig = {
  enabled: true,
  modelPath: 'centernet.json',
  minConfidence: PERSON_CONFIDENCE,
  iouThreshold: 0.45,
  maxDetected: 20,
  skipFrames: 0,
  skipTime: 0,
};

/**
 * One engine, switched per call. The library keeps its models and image buffers
 * in module state, so two instances would overwrite each other.
 */
async function ensureEngines() {
  if (engines) return engines;
  loading ||= (async () => {
    const human = new Human({
      ...base,
      body: off,
      face: faceConfig,
      object: objectConfig,
    });
    await human.load();
    // The library drops models that the first call leaves switched off, so the
    // first call uses every detector. It also compiles the shaders.
    const blank = new OffscreenCanvas(PEOPLE_INPUT, PEOPLE_INPUT);
    blank.getContext('2d').fillRect(0, 0, PEOPLE_INPUT, PEOPLE_INPUT);
    await human.detect(blank, { face: faceConfig, object: objectConfig });
    engines = {
      human,
      people: {
        detect: (input) =>
          human.detect(input, { face: off, object: objectConfig }),
      },
      faces: {
        detect: (input) =>
          human.detect(input, { face: faceConfig, object: off }),
      },
    };
    return engines;
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
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
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

/** Draw one region of the frame, enlarged so a distant face has more pixels. */
function crop(image, [x, y, width, height]) {
  const scale = Math.max(1, Math.min(4, CROP_WIDTH / width));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  );
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    x,
    y,
    width,
    height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return { canvas, scale };
}

/** Find faces in one region and report them in frame coordinates. */
async function facesIn(faces, image, region) {
  const { canvas, scale } = crop(image, region);
  const result = await faces.detect(canvas);
  return result.face.map((face) => {
    const [x, y, width, height] = face.box.map(Number);
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const w = Math.min(canvas.width - left, Math.ceil(width));
    const h = Math.min(canvas.height - top, Math.ceil(height));
    let sharpness = null;
    if (w > 4 && h > 4) {
      // Judge blur at a fixed size so near and far faces are comparable.
      const sample = new OffscreenCanvas(96, 96);
      const pixels = sample.getContext('2d');
      pixels.drawImage(canvas, left, top, w, h, 0, 0, 96, 96);
      sharpness = sharpnessOf(pixels.getImageData(0, 0, 96, 96).data, 96, 96);
    }
    return {
      box: [
        region[0] + x / scale,
        region[1] + y / scale,
        width / scale,
        height / scale,
      ],
      score: Math.max(Number(face.boxScore) || 0, Number(face.faceScore) || 0),
      yaw: face.rotation?.angle?.yaw,
      pitch: face.rotation?.angle?.pitch,
      real: face.real,
      live: face.live,
      sharpness,
      embedding: Array.isArray(face.embedding) ? face.embedding : null,
    };
  });
}

/**
 * Find people. The detector expects a square, and squeezing a wide frame into
 * one distorts bodies until it misses them, so the frame is padded instead. One
 * square close-up per frame, alternating sides, picks up distant people.
 */
async function bodiesIn(people, image) {
  const found = [];
  for (const view of peopleViews(image.width, image.height, frameNumber)) {
    const canvas = new OffscreenCanvas(PEOPLE_INPUT, PEOPLE_INPUT);
    const context = canvas.getContext('2d');
    context.fillStyle = '#777';
    context.fillRect(0, 0, PEOPLE_INPUT, PEOPLE_INPUT);
    const scale = PEOPLE_INPUT / view.size;
    context.drawImage(
      image,
      -view.x * scale,
      -view.y * scale,
      image.width * scale,
      image.height * scale,
    );
    const result = await people.detect(canvas);
    for (const { label, score, box } of result.object)
      if (label === 'person' && score >= PERSON_CONFIDENCE)
        found.push({
          score,
          box: [
            view.x + box[0] / scale,
            view.y + box[1] / scale,
            box[2] / scale,
            box[3] / scale,
          ],
          face: null,
        });
  }
  frameNumber += 1;
  return mergePeople(found, image.width, image.height).slice(0, MAX_PEOPLE);
}

/** People first, then faces inside each person, then close-up faces. */
async function detectPeople(image) {
  const { people, faces } = await ensureEngines();
  const bodies = await bodiesIn(people, image);
  for (const body of bodies) {
    const found = await facesIn(
      faces,
      image,
      headRegion(body.box, image.width, image.height),
    );
    body.face =
      found
        .filter((face) => containment(face.box, body.box) > 0.5)
        .sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])[0] || null;
  }
  // A head filling the frame is often not detected as a person.
  const whole = await facesIn(faces, image, [0, 0, image.width, image.height]);
  for (const face of whole) {
    if (bodies.some((body) => body.face && iou(body.face.box, face.box) > 0.3))
      continue;
    const owner = bodies.find(
      (body) => !body.face && containment(face.box, body.box) > 0.6,
    );
    if (owner) owner.face = face;
    else if (bodies.length < MAX_PEOPLE)
      bodies.push({ box: face.box, score: face.score, face });
  }
  return bodies;
}

const round = (value, digits = 2) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

async function analyze({ image, thresholdPct }) {
  const people = await detectPeople(image);
  const usable = [];
  for (const person of people) {
    if (!person.face) continue;
    person.quality = assessFace(person.face);
    if (person.quality.usable && person.face.embedding) usable.push(person);
  }
  if (usable.length) {
    const { results } = await api('/match', {
      embeddings: usable.map(({ face }) => face.embedding),
      thresholdPct,
    });
    usable.forEach((person, index) => {
      const match = results[index];
      person.match = match;
      person.vote =
        match.status === 'possible-match'
          ? {
              id: match.id,
              name: match.name,
              category: match.category,
              similarityPct: match.similarityPct,
            }
          : { id: null, name: '', similarityPct: match.similarityPct };
    });
  }
  const tracks = tracker.update(people);
  return {
    people: tracks.map((track) => {
      const person = people.find(({ box }) => box === track.box);
      const candidate = track.decision.state === 'candidate';
      return {
        id: track.id,
        box: track.box.map((value) => round(value, 1)),
        score: round(track.score),
        decision: track.decision,
        isNew: candidate && tracker.claimReport(track.id, track.decision.id),
        face: track.face
          ? {
              box: track.face.box.map((value) => round(value, 1)),
              edgePx: Math.round(
                Math.min(track.face.box[2], track.face.box[3]),
              ),
              live: round(track.face.live),
              real: round(track.face.real),
              quality: person?.quality || null,
              similarityPct: person?.match?.similarityPct ?? null,
              matchStatus: person?.match?.status ?? null,
            }
          : null,
      };
    }),
  };
}

async function enroll(message) {
  const { faces } = await ensureEngines();
  const { images } = message;
  if (!Array.isArray(images) || images.length < 1 || images.length > 8)
    throw new Error('Choose between 1 and 8 reference photos');
  const embeddings = [];
  for (const [index, image] of images.entries()) {
    try {
      const found = await facesIn(faces, image, [
        0,
        0,
        image.width,
        image.height,
      ]);
      if (found.length !== 1 || !found[0].embedding)
        throw new Error(
          `Reference photo ${index + 1} must contain exactly one clear face`,
        );
      // A printed or on-screen portrait is a normal reference photo.
      const quality = assessFace(
        { ...found[0], real: undefined, live: undefined },
        { minEdgePx: ENROLL_MIN_FACE_EDGE_PX },
      );
      if (!quality.usable)
        throw new Error(`Reference photo ${index + 1}: ${quality.reason}`);
      embeddings.push(found[0].embedding);
    } finally {
      image.close?.();
    }
  }
  return api('/identities', {
    name: message.name,
    category: message.category,
    note: message.note,
    consentConfirmed: message.consentConfirmed === true,
    allowPossibleDuplicate: message.allowPossibleDuplicate === true,
    embeddings,
  });
}

async function handleMessage(message) {
  if (message.type === 'initialize') {
    const [{ human }, status] = await Promise.all([
      ensureEngines(),
      api('/status'),
    ]);
    return {
      ready: true,
      backend: human.tf?.getBackend?.() || 'webgl',
      identityCount: status.identities,
    };
  }
  if (message.type === 'enroll') return enroll(message);
  if (message.type === 'reset') {
    tracker.reset();
    return { reset: true };
  }
  if (message.type === 'analyze') {
    try {
      return await analyze(message);
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
