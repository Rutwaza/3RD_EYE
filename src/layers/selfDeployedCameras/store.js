export const SELF_DEPLOYED_CAMERA_STORAGE_KEY = 'gev:self-deployed-cameras:v1';
export const SELF_DEPLOYED_CAMERA_LIMIT = 64;

function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function validCamera(input, { generatedId = null } = {}) {
  if (!input || typeof input !== 'object')
    throw new TypeError('Enter the camera details');
  const name = String(input.name || '').trim();
  if (!name || name.length > 80) throw new TypeError('Camera name is required');
  const streamUrl = String(input.streamUrl || input.url || '').trim();
  if (!streamUrl || streamUrl.length > 2048)
    throw new TypeError('Enter a valid stream URL');
  let parsed;
  try {
    parsed = new URL(streamUrl);
  } catch {
    throw new TypeError('Stream URL must be an absolute HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new TypeError('Stream URL must use HTTP or HTTPS');
  if (parsed.username || parsed.password)
    throw new TypeError('Do not put a username or password in the stream URL');
  if (parsed.hash) throw new TypeError('Stream URL cannot include a fragment');
  if (
    input.lat === null ||
    input.lat === undefined ||
    String(input.lat).trim() === '' ||
    input.lon === null ||
    input.lon === undefined ||
    String(input.lon).trim() === ''
  )
    throw new TypeError('Latitude and longitude are required');
  const lat = Number(input.lat);
  const lon = Number(input.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90)
    throw new TypeError('Latitude must be between -90 and 90');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180)
    throw new TypeError('Longitude must be between -180 and 180');
  const id = String(input.id || generatedId || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(id))
    throw new TypeError('Camera identity is invalid');
  return Object.freeze({
    id,
    name,
    streamUrl: parsed.href,
    lat,
    lon,
    feedType: 'mjpeg',
    sourceKind: 'self-deployed',
  });
}

function generatedId() {
  return `self-camera-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 12)}`;
}

/** Persist user-entered HTTP MJPEG endpoints and expose a small reactive port. */
export function createSelfDeployedCameraStore({
  storage = browserStorage(),
  storageKey = SELF_DEPLOYED_CAMERA_STORAGE_KEY,
} = {}) {
  let cameras = [];
  let enabled = false;
  let selectedId = null;
  const listeners = new Set();

  if (storage) {
    try {
      const stored = JSON.parse(storage.getItem(storageKey) || '[]');
      if (Array.isArray(stored)) {
        cameras = stored
          .slice(0, SELF_DEPLOYED_CAMERA_LIMIT)
          .map((camera) => validCamera(camera));
      }
    } catch {
      cameras = [];
    }
  }

  const list = () => cameras.map((camera) => ({ ...camera }));
  const selected = () => {
    const camera = cameras.find(({ id }) => id === selectedId);
    return camera ? { ...camera } : null;
  };
  const publish = (reason, camera = selected()) => {
    const event = { reason, enabled, cameras: list(), camera };
    for (const listener of [...listeners]) listener(event);
  };
  const persist = (next) => {
    if (!storage) throw new Error('Browser storage is unavailable');
    storage.setItem(storageKey, JSON.stringify(next));
  };

  return Object.freeze({
    list,
    selected,
    isEnabled: () => enabled,
    subscribe(listener) {
      if (typeof listener !== 'function')
        throw new TypeError('Camera store listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setEnabled(value) {
      const next = value === true;
      if (enabled === next) return;
      enabled = next;
      publish('layer-state');
    },
    select(id, reason = 'selection') {
      if (!enabled) return null;
      const camera = cameras.find((candidate) => candidate.id === id);
      if (!camera) return null;
      selectedId = camera.id;
      publish(reason, { ...camera });
      return { ...camera };
    },
    add(input) {
      if (cameras.length >= SELF_DEPLOYED_CAMERA_LIMIT)
        throw new TypeError(
          `Maximum ${SELF_DEPLOYED_CAMERA_LIMIT} cameras reached`,
        );
      const camera = validCamera(input, { generatedId: generatedId() });
      if (cameras.some(({ id }) => id === camera.id))
        throw new TypeError('Camera identity already exists');
      const next = [...cameras, camera];
      persist(next);
      cameras = next;
      if (enabled) selectedId = camera.id;
      publish('camera-added', enabled ? { ...camera } : selected());
      return { ...camera };
    },
    remove(id) {
      const next = cameras.filter((camera) => camera.id !== id);
      if (next.length === cameras.length) return false;
      persist(next);
      cameras = next;
      if (selectedId === id) selectedId = null;
      publish('camera-removed');
      return true;
    },
  });
}
