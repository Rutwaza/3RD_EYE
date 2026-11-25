import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelfDeployedCameraStore } from './store.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const cameraInput = {
  name: 'Workshop camera',
  streamUrl: 'http://192.168.1.45/stream',
  lat: '-1.9774',
  lon: '30.1093',
};

test('camera store validates, persists, selects, and rehydrates deployed cameras', () => {
  const storage = memoryStorage();
  const store = createSelfDeployedCameraStore({ storage });
  const events = [];
  store.subscribe((event) => events.push(event.reason));
  store.setEnabled(true);
  const added = store.add(cameraInput);

  assert.equal(added.name, cameraInput.name);
  assert.equal(added.lat, -1.9774);
  assert.equal(added.lon, 30.1093);
  assert.equal(added.feedType, 'mjpeg');
  assert.equal(store.selected().id, added.id);
  assert.deepEqual(events, ['layer-state', 'camera-added']);

  const restored = createSelfDeployedCameraStore({ storage });
  assert.deepEqual(restored.list(), store.list());
  assert.equal(restored.isEnabled(), false, 'layer activation is runtime state');
});

test('camera store rejects unsupported, credentialed, and out-of-range inputs', () => {
  const store = createSelfDeployedCameraStore({ storage: memoryStorage() });
  assert.throws(
    () => store.add({ ...cameraInput, streamUrl: 'rtsp://192.168.1.45/live' }),
    /HTTP or HTTPS/,
  );
  assert.throws(
    () =>
      store.add({
        ...cameraInput,
        streamUrl: 'http://admin:secret@192.168.1.45/stream',
      }),
    /username or password/,
  );
  assert.throws(() => store.add({ ...cameraInput, lat: 91 }), /Latitude/);
  assert.throws(() => store.add({ ...cameraInput, lon: -181 }), /Longitude/);
  assert.throws(() => store.add({ ...cameraInput, lat: '' }), /required/);
  assert.equal(store.list().length, 0);
});

test('disabled registry cannot select cameras and removal clears a selection', () => {
  const store = createSelfDeployedCameraStore({ storage: memoryStorage() });
  const camera = store.add(cameraInput);
  assert.equal(store.select(camera.id), null);
  store.setEnabled(true);
  assert.equal(store.select(camera.id)?.id, camera.id);
  assert.equal(store.remove(camera.id), true);
  assert.equal(store.selected(), null);
});