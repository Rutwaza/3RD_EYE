import {
  _clearCctvFrame,
  _queueCctvFrame,
  _settleCctvFrame,
  _syncCctvSourceBadge,
} from './cctvFrames.js';
import {
  _activeCctvCameraId,
  _resetCctvCalibration,
  _beginCctvCalValueEdit,
  _syncCctvCalReadout,
} from './cctvCalibration.js';
import {
  _calBadgeLabel,
  _renderCctvState,
  _renderSelfDeployedState,
  _typeCctvSummary,
  _updateCctvSyncChip,
} from './cctvPresentation.js';
import { _initCctvPanel } from './cctvBindings.js';

/** Own camera-panel interaction and presentation; receive the camera port and application actions. */
export class CctvControls {
  constructor({ elements, cctv, actions, selfDeployedCameras = null }) {
    Object.assign(this, elements);
    this.cctv = cctv;
    this.actions = actions;
    this.selfDeployedCameras = selfDeployedCameras;
    this.destroyed = false;
    this.listeners = new AbortController();
    this._cctvUnsubscribe = null;
    this._selfCameraUnsubscribe = null;
    this._cctvState = null;
    this._cctvSummaryTypingTimer = null;
    this._lastCctvSummaryText = '';
    this._lastSeenCctvActiveId = null;
    this._cctvChipHideTimer = null;
    this._cctvChipWasBusy = false;
    this._cctvFrameRequestToken = 0;
    this._cctvFramePreloader = null;
    this._calibrationEdit = null;
    this._actionGeneration = 0;
    this._initCctvPanel();
  }
  listen(target, type, handler, options = {}) {
    target?.addEventListener(type, handler, {
      ...options,
      signal: this.listeners.signal,
    });
  }
  getState() {
    return this._cctvState;
  }
  connect() {
    this._cctvUnsubscribe?.();
    this._selfCameraUnsubscribe?.();
    this._cctvUnsubscribe = null;
    this._selfCameraUnsubscribe = null;
    if (this.destroyed) return;
    this._cctvUnsubscribe = this.cctv.subscribe?.((state) =>
      this._renderCctvState(state),
    );
    if (this.cctv.getUIState) this._renderCctvState(this.cctv.getUIState());
    this._selfCameraUnsubscribe = this.selfDeployedCameras?.subscribe?.(
      (event) => {
        if (event.reason === 'map' || event.reason === 'face-recognition')
          this.actions.setPanelCollapsed?.('cctv-panel', false, {
            explicit: true,
          });
        this._renderCctvState(this._cctvState);
      },
    );
  }
  _clearCctvFrame(...args) {
    return _clearCctvFrame.call(this, ...args);
  }
  _queueCctvFrame(...args) {
    return _queueCctvFrame.call(this, ...args);
  }
  _settleCctvFrame(...args) {
    return _settleCctvFrame.call(this, ...args);
  }
  _syncCctvSourceBadge(...args) {
    return _syncCctvSourceBadge.call(this, ...args);
  }
  _activeCctvCameraId(...args) {
    return _activeCctvCameraId.call(this, ...args);
  }
  _resetCctvCalibration(...args) {
    return _resetCctvCalibration.call(this, ...args);
  }
  _beginCctvCalValueEdit(...args) {
    return _beginCctvCalValueEdit.call(this, ...args);
  }
  _syncCctvCalReadout(...args) {
    return _syncCctvCalReadout.call(this, ...args);
  }
  _calBadgeLabel(...args) {
    return _calBadgeLabel.call(this, ...args);
  }
  _renderCctvState(...args) {
    return _renderCctvState.call(this, ...args);
  }
  _renderSelfDeployedState(...args) {
    return _renderSelfDeployedState.call(this, ...args);
  }
  prepareFaceRecognitionStream() {
    if (!this._cctvFrame || !this.selfDeployedCameras?.isEnabled?.())
      return false;
    this._selfStreamCameraId = null;
    this._clearCctvFrame();
    this._cctvFrame.crossOrigin = 'anonymous';
    return true;
  }
  restoreFaceRecognitionStream() {
    if (!this._cctvFrame) return;
    this._selfStreamCameraId = null;
    this._clearCctvFrame();
    this._cctvFrame.crossOrigin = '';
    if (this.selfDeployedCameras?.isEnabled?.())
      this._renderSelfDeployedState();
  }
  _setSelfCameraStatus(message) {
    if (this._cctvSelfStatus) this._cctvSelfStatus.textContent = message;
  }
  _typeCctvSummary(...args) {
    return _typeCctvSummary.call(this, ...args);
  }
  _updateCctvSyncChip(...args) {
    return _updateCctvSyncChip.call(this, ...args);
  }
  _initCctvPanel(...args) {
    return _initCctvPanel.call(this, ...args);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._actionGeneration++;
    this.listeners.abort();
    this._cctvUnsubscribe?.();
    this._cctvUnsubscribe = null;
    this._selfCameraUnsubscribe?.();
    this._selfCameraUnsubscribe = null;
    this._calibrationEdit?.(false);
    this._clearCctvFrame();
    clearInterval(this._cctvSummaryTypingTimer);
    clearTimeout(this._cctvChipHideTimer);
    this._cctvSummaryTypingTimer = null;
    this._cctvChipHideTimer = null;
    this._cctvSyncChip?.classList.remove('visible');
  }
}
