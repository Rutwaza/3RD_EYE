import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceRecognitionPanel, describePerson } from './faceRecognitionPanel.js';
import { createSelfDeployedCameraStore } from '../layers/selfDeployedCameras/store.js';

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.options = [];
    this.dataset = {};
    this.value = '';
    this.disabled = false;
    this.textContent = '';
    this.files = [];
  }
  appendChild(child) {
    this.children.push(child);
    this.options.push(child);
  }
  reset() {
    this.value = '';
  }
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('face panel selects a deployed camera, starts one-frame matching, and restores CCTV on stop', async (t) => {
  const previousDocument = globalThis.document;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.document = {
    createElement(name) {
      if (name === 'canvas')
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage() {} }),
        };
      return new FakeElement();
    },
  };
  globalThis.createImageBitmap = async () => ({ close() {} });
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousCreateImageBitmap === undefined)
      delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = previousCreateImageBitmap;
  });

  const cameraStore = createSelfDeployedCameraStore({ storage: memoryStorage() });
  const camera = cameraStore.add({
    name: 'Workshop',
    streamUrl: 'http://192.168.1.45/stream',
    lat: 47.6,
    lon: -122.3,
  });
  let resolveAnalysis;
  const analysisComplete = new Promise((resolve) => {
    resolveAnalysis = resolve;
  });
  let worker;
  const workerFactory = () => {
    worker = {
      postMessage(message) {
        queueMicrotask(() => {
          worker.onmessage({
            data: {
              requestId: message.requestId,
              ok: true,
              result:
                message.type === 'analyze'
                  ? {
                      people: [
                        {
                          id: 'H01',
                          box: [0, 0, 10, 20],
                          decision: {
                            state: 'candidate',
                            id: 'x',
                            name: 'Dev teammate',
                            category: 'visitor',
                            similarityPct: 82,
                            votes: 3,
                          },
                          isNew: true,
                          face: null,
                        },
                      ],
                    }
                  : { ready: true },
            },
          });
          if (message.type === 'analyze') resolveAnalysis();
        });
      },
      terminate() {},
    };
    return worker;
  };
  const frame = { complete: true, naturalWidth: 640, naturalHeight: 480 };
  const elements = {
    _faceRecognitionCamera: new FakeElement(),
    _faceRecognitionStart: new FakeElement(),
    _faceRecognitionStop: new FakeElement(),
    _faceRecognitionThreshold: Object.assign(new FakeElement(), { value: '70' }),
    _faceRecognitionThresholdValue: new FakeElement(),
    _faceRecognitionStatus: new FakeElement(),
    _faceRecognitionResults: new FakeElement(),
    _faceRecognitionEnrollForm: new FakeElement(),
    _faceRecognitionName: new FakeElement(),
    _faceRecognitionPhotos: new FakeElement(),
    _faceRecognitionConsent: new FakeElement(),
    _faceRecognitionPeople: new FakeElement(),
  };
  elements._faceRecognitionCamera.value = camera.id;
  const actions = {
    async enableCameraLayer() {
      cameraStore.setEnabled(true);
      return true;
    },
    prepareStreamForAnalysis() {
      actions.prepared = true;
    },
    restoreStreamAfterAnalysis() {
      actions.restored = true;
    },
    readStreamImage: () => frame,
  };
  const requests = [];
  const panel = new FaceRecognitionPanel({
    elements,
    cameraStore,
    actions,
    fetchImpl: async (url, options) => {
      requests.push([options?.method || 'GET', url]);
      return { ok: true, json: async () => ({ identities: [] }) };
    },
    workerFactory,
  });
  t.after(() => panel.destroy());

  await panel.start();
  await analysisComplete;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cameraStore.selected().id, camera.id);
  assert.equal(actions.prepared, true);
  assert.equal(
    elements._faceRecognitionResults.children.length,
    1,
    elements._faceRecognitionStatus.textContent,
  );
  assert.match(elements._faceRecognitionResults.children[0].textContent, /CANDIDATE Dev teammate/);
  assert.ok(
    requests.some(([method, url]) => method === 'POST' && url.endsWith('/sightings')),
    'a new candidate is recorded once',
  );
  await panel.stop('Stopped');
  assert.equal(actions.restored, true);
  assert.equal(elements._faceRecognitionStop.disabled, true);
});
test('a likely photo or screen is never compared, and says so', () => {
  const { tone, text } = describePerson({
    id: 'H01',
    decision: { state: 'low-quality', votes: 0 },
    face: { quality: { usable: false, code: 'spoof', reason: 'may be a photo or a screen' } },
  });
  assert.equal(tone, 'spoof');
  assert.match(text, /NOT COMPARED/);
});
