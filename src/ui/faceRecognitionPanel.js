const API_ROOT = '/api/face-recognition';
const FRAME_INTERVAL_MS = 300;
const MAX_ANALYSIS_WIDTH = 1_280;
const MAX_REFERENCE_PHOTOS = 8;
const MAX_REFERENCE_PHOTO_BYTES = 8 * 1024 * 1024;
export const WEBCAM_ID = '__webcam';
const CATEGORY_LABELS = {
  authorised: 'AUTHORISED',
  visitor: 'VISITOR',
  poi: 'PERSON OF INTEREST',
};
const COLORS = {
  human: '#35e0ff',
  'low-quality': '#ffd166',
  analysing: '#9b6bff',
  unknown: '#9fb4d1',
  authorised: '#3ee6a8',
  visitor: '#4f9bff',
  poi: '#ff4d6d',
};

/** What one tracked person's row says. Exported for tests. */
export function describePerson(person) {
  const { decision, face, id } = person;
  if (decision.state === 'candidate')
    return {
      tone: 'possible',
      text: `${id} · CANDIDATE ${decision.name} · ${CATEGORY_LABELS[decision.category] || 'ENROLLED'} · ${decision.similarityPct}/100 · ${decision.votes} FRAMES`,
    };
  if (face?.quality?.code === 'spoof')
    return { tone: 'spoof', text: `${id} · NOT COMPARED · ${face.quality.reason}` };
  if (decision.state === 'analysing')
    return {
      tone: 'analysing',
      text: `${id} · READING FACE ${decision.votes}/${decision.needed}`,
    };
  if (decision.state === 'unknown')
    return { tone: 'unknown', text: `${id} · NOT IN THE DATABASE` };
  if (face && face.quality && !face.quality.usable)
    return { tone: 'quality', text: `${id} · FACE SEEN · ${face.quality.reason}` };
  return { tone: 'human', text: `${id} · PERSON · NO FACE VISIBLE` };
}

/** Face Map panel. It owns its worker, its requests and one preview canvas. */
export class FaceRecognitionPanel {
  constructor({
    elements,
    cameraStore,
    actions,
    fetchImpl = fetch,
    workerFactory = null,
    openWebcam = () =>
      navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      }),
  }) {
    Object.assign(this, elements);
    this.cameraStore = cameraStore;
    this.actions = actions;
    this.fetch = fetchImpl;
    this.workerFactory = workerFactory;
    this.openWebcam = openWebcam;
    this.destroyed = false;
    this.running = false;
    this.activeCameraId = null;
    this.activeCameraName = '';
    this._webcam = null;
    this._sampleTimer = null;
    this._worker = null;
    this._workerReady = null;
    this._requestId = 0;
    this._startToken = 0;
    this._pending = new Map();
    this._listeners = new AbortController();
    this._canvas = document.createElement('canvas');
    this._context = this._canvas.getContext('2d', { willReadFrequently: true });
    this._viewContext = this._faceRecognitionView?.getContext?.('2d') || null;
    this._cameraUnsubscribe = cameraStore?.subscribe?.((event) =>
      this._onCameraStoreChange(event),
    );
    this._listen(this._faceRecognitionCamera, 'change', () => {
      if (
        this.running &&
        this._faceRecognitionCamera.value !== this.activeCameraId
      )
        void this.stop('Camera selection changed');
      this._renderCameras();
    });
    this._listen(this._faceRecognitionStart, 'click', () => void this.start());
    this._listen(
      this._faceRecognitionStop,
      'click',
      () => void this.stop('Stopped'),
    );
    this._listen(this._faceRecognitionThreshold, 'input', () => {
      if (this._faceRecognitionThresholdValue)
        this._faceRecognitionThresholdValue.textContent = `${this._threshold()}/100`;
    });
    this._listen(this._faceRecognitionEnrollForm, 'submit', (event) => {
      event.preventDefault();
      void this.enroll();
    });
    this._listen(this._faceRecognitionClear, 'click', () => {
      if (
        typeof globalThis.confirm !== 'function' ||
        globalThis.confirm('Delete every recorded sighting? This cannot be undone.')
      )
        void this._send('/sightings', 'DELETE').then(() => this.refreshLog());
    });
    this._bindTabs();
    this._listen(
      globalThis.window,
      'focus',
      () => void this.refreshPeople(),
    );
    this._renderCameras();
    this._renderDatabaseSummary([]);
    this._renderPeopleInFrame([]);
    void this.refreshPeople();
  }

  _listen(target, type, listener) {
    target?.addEventListener?.(type, listener, {
      signal: this._listeners.signal,
    });
  }

  _bindTabs() {
    const root = this._faceRecognitionView?.closest?.('.face-recognition-inner');
    if (!root) return;
    const tabs = [...root.querySelectorAll('[data-face-tab]')];
    const views = [...root.querySelectorAll('[data-face-view]')];
    for (const tab of tabs)
      this._listen(tab, 'click', () => {
        for (const item of tabs)
          item.setAttribute('aria-selected', String(item === tab));
        for (const view of views)
          view.hidden = view.dataset.faceView !== tab.dataset.faceTab;
        if (tab.dataset.faceTab === 'people') void this.refreshPeople();
        if (tab.dataset.faceTab === 'log') void this.refreshLog();
      });
  }

  _threshold() {
    return Math.max(
      50,
      Math.min(95, Number(this._faceRecognitionThreshold?.value) || 70),
    );
  }

  _setStatus(text) {
    if (this._faceRecognitionStatus)
      this._faceRecognitionStatus.textContent = text;
  }

  _onCameraStoreChange(event) {
    if (this.destroyed) return;
    this._renderCameras();
    if (!this.running || this.activeCameraId === WEBCAM_ID) return;
    if (!event.enabled) {
      void this.stop('Self deployed cameras turned off', {
        restoreStream: false,
      });
      return;
    }
    if (event.camera?.id !== this.activeCameraId)
      void this.stop('Camera selection changed');
  }

  _renderCameras() {
    const select = this._faceRecognitionCamera;
    if (!select) return;
    const rows = [
      ['', 'SELECT A CAMERA'],
      ...(this.cameraStore?.list?.() || []).map(({ id, name }) => [id, name]),
      [WEBCAM_ID, 'THIS COMPUTER’S CAMERA'],
    ];
    const current = this.activeCameraId || select.value;
    const same =
      select.options.length === rows.length &&
      rows.every(([id], index) => select.options[index]?.value === id);
    if (!same) {
      select.textContent = '';
      for (const [id, name] of rows) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        select.appendChild(option);
      }
    }
    if (rows.some(([id]) => id === current)) select.value = current;
    select.disabled = this.running;
    if (this._faceRecognitionStart)
      this._faceRecognitionStart.disabled = this.running;
  }

  async _send(path, method = 'GET', body) {
    const response = await this.fetch(`${API_ROOT}${path}`, {
      method,
      cache: 'no-store',
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(payload?.error || `Local API returned HTTP ${response.status}`);
    return payload;
  }

  async refreshPeople() {
    if (this.destroyed) return;
    try {
      const payload = await this._send('/identities');
      if (!Array.isArray(payload?.identities))
        throw new Error(
          'Local API response is invalid; restart with npm run dev',
        );
      this._renderPeople(payload.identities);
      if (!this.running)
        this._setStatus('READY · PHOTOS AND FRAMES ARE NOT SAVED');
    } catch (error) {
      const detail =
        error?.name === 'TypeError'
          ? 'Open http://localhost:4173 after running npm run dev'
          : error?.message || 'Connection failed';
      this._setStatus(`LOCAL FACE SERVICE UNAVAILABLE · ${detail}`);
    }
  }

  _renderPeople(identities) {
    this._renderDatabaseSummary(identities);
    if (!this._faceRecognitionPeople) return;
    this._faceRecognitionPeople.textContent = '';
    for (const identity of identities) {
      const row = document.createElement('div');
      row.className = 'face-recognition-person';
      row.dataset.category = identity.category || 'authorised';
      const label = document.createElement('span');
      label.textContent = `${identity.name} · ${CATEGORY_LABELS[identity.category] || 'ENROLLED'} · ${identity.templateCount} templates${identity.note ? ` · ${identity.note}` : ''}`;
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
      (total, identity) =>
        total + Math.max(0, Number(identity.templateCount) || 0),
      0,
    );
    this._faceRecognitionDatabase.textContent = `DATABASE · ${identities.length} REGISTERED FACES · ${templates} REFERENCE TEMPLATES`;
  }

  async refreshLog() {
    if (this.destroyed || !this._faceRecognitionSightings) return;
    try {
      const [{ sightings }, audit] = await Promise.all([
        this._send('/sightings'),
        this._send('/audit'),
      ]);
      this._renderSightings(sightings);
      this._renderAudit(audit);
    } catch (error) {
      this._setStatus(error.message || 'The log is unavailable');
    }
  }

  _renderSightings(sightings) {
    const box = this._faceRecognitionSightings;
    box.textContent = '';
    if (!sightings.length) {
      const empty = document.createElement('div');
      empty.className = 'face-recognition-result';
      empty.textContent = 'NO CANDIDATES RECORDED IN THE LAST 30 DAYS';
      box.appendChild(empty);
      return;
    }
    for (const sighting of sightings.slice(0, 40)) {
      const row = document.createElement('div');
      row.className = 'face-sighting';
      row.dataset.category = sighting.category;
      const label = document.createElement('span');
      label.textContent = `${sighting.name} · ${sighting.cameraName || 'camera'} · ${sighting.similarityPct}/100 · ${new Date(sighting.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}`;
      row.append(label);
      if (sighting.review) {
        const verdict = document.createElement('b');
        verdict.textContent = sighting.review.toUpperCase();
        row.append(verdict);
      } else {
        for (const [verdict, text] of [
          ['confirmed', 'CONFIRM'],
          ['rejected', 'REJECT'],
        ]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'scene-btn';
          button.textContent = text;
          this._listen(button, 'click', () => {
            void this._send(`/sightings/${sighting.id}/review`, 'POST', {
              verdict,
            })
              .then(() => this.refreshLog())
              .catch((error) => this._setStatus(error.message));
          });
          row.append(button);
        }
      }
      box.appendChild(row);
    }
  }

  _renderAudit(audit) {
    if (this._faceRecognitionAuditState) {
      this._faceRecognitionAuditState.textContent = audit.intact
        ? `CHAIN INTACT · ${audit.total}`
        : 'CHAIN BROKEN';
      this._faceRecognitionAuditState.dataset.intact = String(audit.intact);
    }
    const box = this._faceRecognitionAudit;
    if (!box) return;
    box.textContent = '';
    for (const entry of audit.rows.slice(0, 30)) {
      const row = document.createElement('div');
      row.className = 'face-audit-row';
      row.textContent = [
        new Date(entry.at).toLocaleString('en-GB', {
          dateStyle: 'short',
          timeStyle: 'short',
        }),
        entry.action,
        entry.subject,
        entry.detail,
      ]
        .filter(Boolean)
        .join(' · ');
      box.appendChild(row);
    }
  }

  async _ensureWorker() {
    if (this._workerReady) return this._workerReady;
    this._worker = this.workerFactory
      ? this.workerFactory(
          new URL('../faceRecognition/worker.js', import.meta.url),
        )
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
    this._worker.onerror = () =>
      this._failWorker(new Error('Face model worker failed'));
    this._workerReady = this._request('initialize', {}, [], 120_000).catch(
      (error) => {
        this._failWorker(error);
        throw error;
      },
    );
    return this._workerReady;
  }

  _request(type, payload = {}, transfer = [], timeoutMs = 30_000) {
    if (!this._worker)
      return Promise.reject(new Error('Face model worker is not ready'));
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

  async _startWebcam() {
    const stream = await this.openWebcam();
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    this._webcam = { stream, video };
    await video.play();
  }

  _stopWebcam() {
    for (const track of this._webcam?.stream?.getTracks?.() || []) track.stop();
    if (this._webcam?.video) this._webcam.video.srcObject = null;
    this._webcam = null;
  }

  async start() {
    if (this.destroyed || this.running || this._starting) return;
    const cameraId = this._faceRecognitionCamera?.value;
    const webcam = cameraId === WEBCAM_ID;
    const camera = webcam
      ? { id: WEBCAM_ID, name: 'This computer' }
      : this.cameraStore?.list?.().find(({ id }) => id === cameraId);
    if (!camera) {
      this._setStatus('SELECT A CAMERA FIRST');
      return;
    }
    const token = ++this._startToken;
    this._starting = true;
    this._setStatus('LOADING PEOPLE AND FACE MODELS…');
    if (this._faceRecognitionStop) this._faceRecognitionStop.disabled = false;
    try {
      await this._ensureWorker();
      await this._request('reset');
      if (token !== this._startToken) return;
      if (webcam) {
        await this._startWebcam();
        if (token !== this._startToken) return this._stopWebcam();
      } else {
        const enabledByPanel = await this.actions.enableCameraLayer();
        if (token !== this._startToken) return;
        if (enabledByPanel === false)
          throw new Error('Could not enable self deployed cameras');
      }
      this.activeCameraId = camera.id;
      this.activeCameraName = camera.name;
      if (!webcam) {
        this.actions.prepareStreamForAnalysis?.();
        if (!this.cameraStore.select(camera.id, 'face-recognition'))
          throw new Error('Camera is no longer available');
      }
      this.running = true;
      this._renderCameras();
      this._setStatus(`LIVE · ${camera.name.toUpperCase()} · REVIEW EVERY CANDIDATE`);
      void this._send('/session', 'POST', {
        action: 'started',
        cameraName: camera.name,
      }).catch(() => {});
      void this._analysisLoop();
    } catch (error) {
      if (token !== this._startToken) return;
      this._setStatus(
        error?.name === 'NotAllowedError'
          ? 'CAMERA ACCESS WAS NOT ALLOWED'
          : error.message || 'Could not start face matching',
      );
      this._failWorker(error);
      this._stopWebcam();
      if (!webcam) this.actions.restoreStreamAfterAnalysis?.();
      this.activeCameraId = null;
      if (this._faceRecognitionStop) this._faceRecognitionStop.disabled = true;
      this._renderCameras();
    } finally {
      if (token === this._startToken) this._starting = false;
    }
  }

  /** The current frame and its size, or null while nothing has arrived. */
  _readFrame() {
    if (this._webcam) {
      const { video } = this._webcam;
      return video.videoWidth
        ? { source: video, width: video.videoWidth, height: video.videoHeight }
        : null;
    }
    const image = this.actions.readStreamImage?.();
    // An MJPEG image never reports complete, so a known size is enough.
    return image?.naturalWidth
      ? { source: image, width: image.naturalWidth, height: image.naturalHeight }
      : null;
  }

  async _analysisLoop() {
    if (!this.running || this.destroyed) return;
    const token = this._startToken;
    const again = (ms) => {
      this._sampleTimer = setTimeout(() => void this._analysisLoop(), ms);
    };
    const frame = this._readFrame();
    if (!frame || !this._context) {
      again(500);
      return;
    }
    try {
      const scale = Math.min(1, MAX_ANALYSIS_WIDTH / frame.width);
      this._canvas.width = Math.max(1, Math.round(frame.width * scale));
      this._canvas.height = Math.max(1, Math.round(frame.height * scale));
      this._context.drawImage(
        frame.source,
        0,
        0,
        this._canvas.width,
        this._canvas.height,
      );
      const bitmap = await createImageBitmap(this._canvas);
      const { people } = await this._request(
        'analyze',
        { image: bitmap, thresholdPct: this._threshold() },
        [bitmap],
      );
      if (!this.running || this.destroyed || token !== this._startToken) return;
      this._drawView(people || []);
      this._renderPeopleInFrame(people || []);
      for (const person of people || [])
        if (person.isNew) void this._recordSighting(person.decision);
      again(FRAME_INTERVAL_MS);
    } catch (error) {
      if (!this.running || this.destroyed || token !== this._startToken) return;
      this._setStatus(
        error?.name === 'SecurityError'
          ? 'CAMERA CORS REQUIRED · ALLOW THIS APP ORIGIN IN ESP32 FIRMWARE'
          : error.message || 'Face frame processing failed',
      );
      again(2_000);
    }
  }

  async _recordSighting(decision) {
    try {
      await this._send('/sightings', 'POST', {
        identityId: decision.id,
        cameraId: this.activeCameraId,
        cameraName: this.activeCameraName,
        similarityPct: decision.similarityPct,
        votes: decision.votes,
      });
    } catch (error) {
      this._setStatus(error.message || 'The sighting was not recorded');
    }
  }

  _colorOf({ decision, face }) {
    if (decision.state === 'candidate')
      return COLORS[decision.category] || COLORS.authorised;
    if (face?.quality?.code === 'spoof') return COLORS.poi;
    return COLORS[decision.state] || COLORS.human;
  }

  /** Draw the analysed frame with brackets on people and boxes on faces. */
  _drawView(people) {
    const view = this._faceRecognitionView;
    const context = this._viewContext;
    if (!view || !context) return;
    view.width = this._canvas.width;
    view.height = this._canvas.height;
    context.drawImage(this._canvas, 0, 0);
    const unit = Math.max(1, view.width / 640);
    context.font = `600 ${Math.round(12 * unit)}px "JetBrains Mono", monospace`;
    for (const person of people) {
      const color = this._colorOf(person);
      const [x, y, width, height] = person.box;
      const tick = Math.min(width, height) * 0.2;
      context.strokeStyle = color;
      context.lineWidth = 2 * unit;
      context.beginPath();
      for (const [cx, cy, dx, dy] of [
        [x, y, 1, 1],
        [x + width, y, -1, 1],
        [x, y + height, 1, -1],
        [x + width, y + height, -1, -1],
      ]) {
        context.moveTo(cx + dx * tick, cy);
        context.lineTo(cx, cy);
        context.lineTo(cx, cy + dy * tick);
      }
      context.stroke();
      if (person.face) {
        const [fx, fy, fw, fh] = person.face.box;
        context.lineWidth = 1.2 * unit;
        context.strokeRect(fx, fy, fw, fh);
      }
      const label =
        person.decision.state === 'candidate'
          ? `${person.id} ${person.decision.name} ${person.decision.similarityPct}`
          : person.id;
      const textWidth = context.measureText(label).width;
      const top = Math.max(0, y - 18 * unit);
      context.fillStyle = 'rgba(4,8,18,0.8)';
      context.fillRect(x, top, textWidth + 10 * unit, 17 * unit);
      context.fillStyle = color;
      context.fillText(label, x + 5 * unit, top + 13 * unit);
    }
  }

  _renderPeopleInFrame(people) {
    if (this._faceRecognitionCounts) {
      const faces = people.filter(({ face }) => face).length;
      const candidates = people.filter(
        ({ decision }) => decision.state === 'candidate',
      ).length;
      this._faceRecognitionCounts.textContent = `PEOPLE ${people.length} · FACES ${faces} · CANDIDATES ${candidates}`;
    }
    const box = this._faceRecognitionResults;
    if (!box) return;
    box.textContent = '';
    if (!people.length) {
      if (!this.running) return;
      const empty = document.createElement('div');
      empty.className = 'face-recognition-result';
      empty.textContent = 'NO PEOPLE IN VIEW';
      box.appendChild(empty);
      return;
    }
    for (const person of people) {
      const { tone, text } = describePerson(person);
      const row = document.createElement('div');
      row.className = 'face-recognition-result';
      row.dataset.match = tone;
      row.textContent = text;
      box.appendChild(row);
    }
  }

  async _requestEnrollment(files, details, allowPossibleDuplicate = false) {
    const images = [];
    try {
      for (const file of files) images.push(await createImageBitmap(file));
      return await this._request(
        'enroll',
        { ...details, consentConfirmed: true, allowPossibleDuplicate, images },
        images,
        90_000,
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
    if (
      files.some(
        (file) =>
          !file.type.startsWith('image/') ||
          file.size > MAX_REFERENCE_PHOTO_BYTES,
      )
    ) {
      this._setStatus('USE IMAGE FILES UNDER 8 MB EACH');
      return;
    }
    const details = {
      name,
      category: this._faceRecognitionCategory?.value || 'authorised',
      note: String(this._faceRecognitionNote?.value || '').trim(),
    };
    this._setStatus('READING REFERENCE PHOTOS ON THIS COMPUTER');
    try {
      await this._ensureWorker();
      let enrolled;
      try {
        enrolled = await this._requestEnrollment(files, details);
      } catch (error) {
        if (!error.duplicate) throw error;
        await this.refreshPeople();
        const { duplicate } = error;
        const confirmed =
          typeof globalThis.confirm === 'function' &&
          globalThis.confirm(
            `Possible duplicate of ${duplicate.name} (similarity ${duplicate.similarityPct}/100). Cancel if this is the same person; continue only if these are different people.`,
          );
        if (!confirmed) {
          this._setStatus('POSSIBLE DUPLICATE REVIEWED; ENROLLMENT CANCELLED');
          return;
        }
        enrolled = await this._requestEnrollment(files, details, true);
      }
      this._faceRecognitionEnrollForm.reset();
      await this.refreshPeople();
      this._setStatus(
        `ENROLLED ${enrolled.identity.name} · ${enrolled.identity.templateCount} TEMPLATES`,
      );
    } catch (error) {
      this._setStatus(error.message || 'Enrollment failed');
    }
  }

  async removeIdentity(identity) {
    try {
      await this._send(
        `/identities/${encodeURIComponent(identity.id)}`,
        'DELETE',
      );
      await this.refreshPeople();
      this._setStatus(`DELETED ${identity.name} AND THEIR SIGHTINGS`);
    } catch (error) {
      this._setStatus(error.message || 'Could not delete enrollment');
    }
  }

  async stop(reason = 'Stopped', { restoreStream = true } = {}) {
    if (!this.running && !this._worker) return;
    const wasRunning = this.running;
    const webcam = this.activeCameraId === WEBCAM_ID;
    const cameraName = this.activeCameraName;
    this._startToken += 1;
    this._starting = false;
    this.running = false;
    clearTimeout(this._sampleTimer);
    this._sampleTimer = null;
    this.activeCameraId = null;
    this._failWorker(new Error('Face matching stopped'));
    this._stopWebcam();
    if (restoreStream && !webcam) this.actions.restoreStreamAfterAnalysis?.();
    if (this._faceRecognitionStop) this._faceRecognitionStop.disabled = true;
    this._viewContext?.clearRect(
      0,
      0,
      this._faceRecognitionView.width,
      this._faceRecognitionView.height,
    );
    this._renderCameras();
    if (wasRunning)
      void this._send('/session', 'POST', {
        action: 'stopped',
        cameraName,
      }).catch(() => {});
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
