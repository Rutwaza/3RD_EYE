const API_ROOT = '/api/face-recognition';
const FRAME_SAMPLE_MS = 1_000;
const MAX_ANALYSIS_WIDTH = 1_280;
const MAX_REFERENCE_PHOTOS = 8;
const MAX_REFERENCE_PHOTO_BYTES = 8 * 1024 * 1024;

/** Standalone face-analysis card. It shares the active CCTV image but owns its worker and requests. */
export class FaceRecognitionPanel {
  constructor({ elements, cameraStore, actions, fetchImpl = fetch, workerFactory = null }) {
    Object.assign(this, elements);
    this.cameraStore = cameraStore;
    this.actions = actions;
    this.fetch = fetchImpl;
    this.workerFactory = workerFactory;
    this.destroyed = false;
    this.running = false;
    this.activeCameraId = null;
    this._sampleTimer = null;
    this._worker = null;
    this._workerReady = null;
    this._requestId = 0;
    this._pending = new Map();
    this._listeners = new AbortController();
    this._canvas = document.createElement('canvas');
    this._context = this._canvas.getContext('2d', { willReadFrequently: true });
    this._cameraUnsubscribe = cameraStore?.subscribe?.((event) =>
      this._onCameraStoreChange(event),
    );
    this._listen(this._faceRecognitionCamera, 'change', () => {
      if (this.running && this._faceRecognitionCamera.value !== this.activeCameraId)
        void this.stop('Camera selection changed');
    });
    this._listen(this._faceRecognitionStart, 'click', () => void this.start());
    this._listen(this._faceRecognitionStop, 'click', () => void this.stop('Stopped'));
    this._listen(this._faceRecognitionThreshold, 'input', () => {
      if (this._faceRecognitionThresholdValue)
        this._faceRecognitionThresholdValue.textContent = `${this._threshold()}/100`;
    });
    this._listen(this._faceRecognitionEnrollForm, 'submit', (event) => {
      event.preventDefault();
      void this.enroll();
    });
    this._listen(globalThis.window, 'focus', () => void this.refreshPeople());
    this._listen(globalThis.document, 'visibilitychange', () => {
      if (!globalThis.document?.hidden) void this.refreshPeople();
    });
    this._renderCameras();
    this._renderDatabaseSummary([]);
    void this.refreshPeople();
  }

  _listen(target, type, listener) {
    target?.addEventListener(type, listener, {
      signal: this._listeners.signal,
    });
  }

  _threshold() {
    return Math.max(
      50,
      Math.min(95, Number(this._faceRecognitionThreshold?.value) || 70),
    );
  }

  _setStatus(text) {
    if (this._faceRecognitionStatus) this._faceRecognitionStatus.textContent = text;
  }

  _onCameraStoreChange(event) {
    if (this.destroyed) return;
    this._renderCameras();
    if (this.running && !event.enabled) {
      void this.stop('Self deployed cameras turned off', { restoreStream: false });
      return;
    }
    if (this.running && event.camera?.id !== this.activeCameraId)
      void this.stop('Camera selection changed');
  }

  _renderCameras() {
    const select = this._faceRecognitionCamera;
    if (!select) return;
    const cameras = this.cameraStore?.list?.() || [];
    const optionsMatch =
      select.options.length === cameras.length + 1 &&
      select.options[0]?.value === '' &&
      cameras.every((camera, index) => select.options[index + 1]?.value === camera.id);
    if (!optionsMatch) {
      select.textContent = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'SELECT DEPLOYED CAMERA';
      select.appendChild(placeholder);
      for (const camera of cameras) {
        const option = document.createElement('option');
        option.value = camera.id;
        option.textContent = camera.name;
        select.appendChild(option);
      }
    }
    if (this.activeCameraId) select.value = this.activeCameraId;
    select.disabled = !cameras.length || this.running;
    if (this._faceRecognitionStart) {
      this._faceRecognitionStart.disabled = !cameras.length || this.running;
    }
  }

  async refreshPeople() {
    if (this.destroyed) return;
    try {
      const response = await this.fetch(`${API_ROOT}/identities`, {
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error || `Local API returned HTTP ${response.status}`);
      if (!Array.isArray(payload?.identities))
        throw new Error('Local API response is invalid; restart with npm run dev');
      this._renderPeople(payload.identities || []);
      if (!this.running) this._setStatus('LOCAL STORE READY · REFERENCE PHOTOS ARE NOT SAVED');
    } catch (error) {
      const detail = error?.message || 'Connection failed';
      const localServerHint = error?.name === 'TypeError'
        ? 'Open http://localhost:4173 after running npm run dev'
        : detail;
      this._setStatus(`LOCAL FACE SERVICE UNAVAILABLE · ${localServerHint}`);
    }
  }

  _renderPeople(identities) {
    this._renderDatabaseSummary(identities);
    if (!this._faceRecognitionPeople) return;
    this._faceRecognitionPeople.textContent = '';
    for (const identity of identities) {
      const row = document.createElement('div');
      row.className = 'face-recognition-person';
      const label = document.createElement('span');
      label.textContent = `${identity.name} · ${identity.templateCount} templates`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'scene-btn scene-btn-danger';
      remove.textContent = 'DELETE';
      remove.setAttribute('aria-label', `Delete ${identity.name} enrollment`);
      this._listen(remove, 'click', () => void this.removeIdentity(identity));
      row.append(label, remove);
      this._faceRecognitionPeople.appendChild(row);
    }
  }

  _renderDatabaseSummary(identities) {
    if (!this._faceRecognitionDatabase) return;
    const templates = identities.reduce(
      (total, identity) => total + Math.max(0, Number(identity.templateCount) || 0),
      0,
    );
    this._faceRecognitionDatabase.textContent =
      `DATABASE · ${identities.length} REGISTERED FACES · ${templates} REFERENCE TEMPLATES`;
  }

  async _ensureWorker() {
    if (this._workerReady) return this._workerReady;
    this._worker = this.workerFactory
      ? this.workerFactory(new URL('../faceRecognition/worker.js', import.meta.url))
      : new Worker(new URL('../faceRecognition/worker.js', import.meta.url), {
          type: 'module',
          name: 'face-recognition',
        });
    this._worker.onmessage = ({ data }) => {
      const pending = this._pending.get(data?.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this._pending.delete(data.requestId);
      if (data.ok) pending.resolve(data.result);
      else {
        const error = new Error(data.error || 'Face analysis failed');
        error.duplicate = data.duplicate || null;
        pending.reject(error);
      }
    };
    this._worker.onerror = () => this._failWorker(new Error('Face model worker failed'));
    this._workerReady = this._request('initialize', {}, [], 60_000).catch((error) => {
      this._failWorker(error);
      throw error;
    });
    return this._workerReady;
  }

  _request(type, payload = {}, transfer = [], timeoutMs = 30_000) {
    if (!this._worker) return Promise.reject(new Error('Face model worker is not ready'));
    const requestId = ++this._requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestId);
        reject(new Error('Face analysis timed out'));
      }, timeoutMs);
      this._pending.set(requestId, { resolve, reject, timer });
      try {
        this._worker.postMessage({ requestId, type, ...payload }, transfer);
      } catch (error) {
        clearTimeout(timer);
        this._pending.delete(requestId);
        reject(error);
      }
    });
  }

  _failWorker(error) {
    this._worker?.terminate?.();
    this._worker = null;
    this._workerReady = null;
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this._pending.clear();
  }

  async start() {
    if (this.destroyed || this.running) return;
    const cameraId = this._faceRecognitionCamera?.value;
    const camera = this.cameraStore?.list?.().find(({ id }) => id === cameraId);
    if (!camera) {
      this._setStatus('SELECT A SELF DEPLOYED CAMERA');
      return;
    }
    this._setStatus('LOADING LOCAL FACE MODEL…');
    try {
      await this._ensureWorker();
      const enabledByPanel = await this.actions.enableCameraLayer();
      if (enabledByPanel === false)
        throw new Error('Could not enable self deployed cameras');
      this.activeCameraId = camera.id;
      this.actions.prepareStreamForAnalysis?.();
      if (!this.cameraStore.select(camera.id, 'face-recognition'))
        throw new Error('Camera is no longer available');
      this.running = true;
      this._faceRecognitionStart.disabled = true;
      this._faceRecognitionStop.disabled = false;
      this._faceRecognitionCamera.disabled = true;
      this._setStatus('LIVE ANALYSIS · LOCAL PROCESSING · REVIEW ALL CANDIDATES');
      this._analysisLoop();
    } catch (error) {
      this._setStatus(error.message || 'Could not start face matching');
      this._failWorker(error);
      this.actions.restoreStreamAfterAnalysis?.();
      this.activeCameraId = null;
      this._renderCameras();
    }
  }

  async _analysisLoop() {
    if (!this.running || this.destroyed) return;
    const image = this.actions.readStreamImage?.();
    if (!image?.complete || !image.naturalWidth || !this._context) {
      this._sampleTimer = setTimeout(() => this._analysisLoop(), 500);
      return;
    }
    try {
      const scale = Math.min(1, MAX_ANALYSIS_WIDTH / image.naturalWidth);
      this._canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      this._canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      this._context.drawImage(image, 0, 0, this._canvas.width, this._canvas.height);
      const bitmap = await createImageBitmap(this._canvas);
      const { results } = await this._request(
        'analyze',
        { image: bitmap, thresholdPct: this._threshold() },
        [bitmap],
      );
      if (!this.running || this.destroyed) return;
      this._renderResults(results || []);
      this._sampleTimer = setTimeout(() => this._analysisLoop(), FRAME_SAMPLE_MS);
    } catch (error) {
      if (!this.running || this.destroyed) return;
      const corsError = error?.name === 'SecurityError';
      this._setStatus(
        corsError
          ? 'CAMERA CORS REQUIRED · ALLOW THIS APP ORIGIN IN ESP32 FIRMWARE'
          : error.message || 'Face frame processing failed',
      );
      this._sampleTimer = setTimeout(() => this._analysisLoop(), 2_000);
    }
  }

  _renderResults(results) {
    if (!this._faceRecognitionResults) return;
    this._faceRecognitionResults.textContent = '';
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'face-recognition-result';
      empty.textContent = 'NO FACES IN SAMPLED FRAME';
      this._faceRecognitionResults.appendChild(empty);
      return;
    }
    results.forEach((result, index) => {
      const row = document.createElement('div');
      row.className = 'face-recognition-result';
      row.dataset.match = result.status === 'possible-match' ? 'possible' : 'unknown';
      if (result.status === 'low-quality') {
        row.dataset.match = 'quality';
        row.textContent = `FACE ${index + 1} · LOW IMAGE QUALITY · ${result.qualityReason || 'REVIEW FRAME'}`;
      } else {
        row.textContent =
          result.status === 'possible-match'
            ? `FACE ${index + 1} · POSSIBLE ${result.name} · SCORE ${result.similarityPct}/100`
            : `FACE ${index + 1} · NO CANDIDATE · SCORE ${result.similarityPct}/100`;
      }
      this._faceRecognitionResults.appendChild(row);
    });
  }

  async _requestEnrollment(files, name, allowPossibleDuplicate = false) {
    const images = [];
    try {
      for (const file of files) images.push(await createImageBitmap(file));
      return await this._request(
        'enroll',
        { name, consentConfirmed: true, allowPossibleDuplicate, images },
        images,
        60_000,
      );
    } catch (error) {
      for (const image of images) {
        try {
          image.close?.();
        } catch {
          // The worker may already have closed or transferred this bitmap.
        }
      }
      throw error;
    }
  }

  async enroll() {
    if (this.destroyed || !this._faceRecognitionConsent?.checked) {
      this._setStatus('CONFIRM THAT THE PERSON AGREED BEFORE ENROLLMENT');
      return;
    }
    const name = String(this._faceRecognitionName?.value || '').trim();
    const files = [...(this._faceRecognitionPhotos?.files || [])];
    if (!name || !files.length || files.length > MAX_REFERENCE_PHOTOS) {
      this._setStatus('ENTER A NAME AND SELECT 1 TO 8 REFERENCE PHOTOS');
      return;
    }
    if (files.some((file) => !file.type.startsWith('image/') || file.size > MAX_REFERENCE_PHOTO_BYTES)) {
      this._setStatus('USE IMAGE FILES UNDER 8 MB EACH');
      return;
    }
    this._setStatus('PROCESSING REFERENCE PHOTOS LOCALLY');
    try {
      await this._ensureWorker();
      let enrolled;
      try {
        enrolled = await this._requestEnrollment(files, name);
      } catch (error) {
        if (!error.duplicate) throw error;
        await this.refreshPeople();
        const duplicate = error.duplicate;
        const confirmed = typeof globalThis.confirm === 'function' && globalThis.confirm(
          'Possible duplicate of ' + duplicate.name + ' (similarity ' + duplicate.similarityPct + '/100). Cancel if this is the same person; continue only if these are different people.',
        );
        if (!confirmed) {
          this._setStatus('POSSIBLE DUPLICATE REVIEWED; ENROLLMENT CANCELLED');
          return;
        }
        enrolled = await this._requestEnrollment(files, name, true);
      }
      this._faceRecognitionEnrollForm.reset();
      this._faceRecognitionThresholdValue.textContent = this._threshold() + '/100';
      this._setStatus('ENROLLED ' + enrolled.identity.name + ' | ' + enrolled.identity.templateCount + ' TEMPLATES');
      await this.refreshPeople();
    } catch (error) {
      this._setStatus(error.message || 'Enrollment failed');
    }
  }

  async removeIdentity(identity) {
    try {
      const response = await this.fetch(
        `${API_ROOT}/identities/${encodeURIComponent(identity.id)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) throw new Error('Could not delete enrollment');
      this._setStatus(`DELETED ${identity.name}`);
      await this.refreshPeople();
    } catch (error) {
      this._setStatus(error.message || 'Could not delete enrollment');
    }
  }

  async stop(reason = 'Stopped', { restoreStream = true } = {}) {
    if (!this.running && !this._worker) return;
    this.running = false;
    clearTimeout(this._sampleTimer);
    this._sampleTimer = null;
    this.activeCameraId = null;
    this._failWorker(new Error('Face matching stopped'));
    if (restoreStream) this.actions.restoreStreamAfterAnalysis?.();
    if (this._faceRecognitionStop) this._faceRecognitionStop.disabled = true;
    this._renderCameras();
    if (!this.destroyed) this._setStatus(reason.toUpperCase());
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._listeners.abort();
    this._cameraUnsubscribe?.();
    this._cameraUnsubscribe = null;
    void this.stop('Stopped during app shutdown', { restoreStream: false });
    this._canvas.width = 1;
    this._canvas.height = 1;
  }
}
