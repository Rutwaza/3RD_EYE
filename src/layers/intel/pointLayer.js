import * as Cesium from 'cesium';

const LABEL_CAP = 70;
const SURFACE_SAMPLE_CAP = 40;
const SURFACE_SAMPLE_HEIGHT_M = 90_000;
const LABEL_HEIGHT_PX = 20;
const CHARACTER_PX = 6.8;
const markerCache = new Map();
/** Label rectangles per layer, so layers do not write over each other. */
const labelRects = new Map();

const overlaps = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** One glowing HUD marker per colour and shape, shared by every layer. */
function marker(color, shape) {
  const key = `${shape}:${color}`;
  if (markerCache.has(key)) return markerCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 48;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const glow = context.createRadialGradient(24, 24, 2, 24, 24, 23);
  glow.addColorStop(0, `${color}88`);
  glow.addColorStop(1, `${color}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, 48, 48);
  context.fillStyle = color;
  context.strokeStyle = 'rgba(4,8,18,0.9)';
  context.lineWidth = 2;
  context.beginPath();
  if (shape === 'diamond') {
    context.moveTo(24, 14);
    context.lineTo(34, 24);
    context.lineTo(24, 34);
    context.lineTo(14, 24);
    context.closePath();
  } else if (shape === 'triangle') {
    context.moveTo(24, 13);
    context.lineTo(35, 33);
    context.lineTo(13, 33);
    context.closePath();
  } else if (shape === 'square') {
    context.rect(16, 16, 16, 16);
  } else {
    context.arc(24, 24, 8, 0, Math.PI * 2);
  }
  context.fill();
  context.stroke();
  if (shape === 'pulse') {
    context.strokeStyle = color;
    context.lineWidth = 1.6;
    for (const radius of [13, 18]) {
      context.globalAlpha = radius === 13 ? 0.9 : 0.45;
      context.beginPath();
      context.arc(24, 24, radius, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;
  }
  markerCache.set(key, canvas);
  return canvas;
}

const shortTitle = (title) =>
  title.length > 30 ? `${title.slice(0, 29).trimEnd()}…` : title;

function validItem(item) {
  return (
    item &&
    typeof item.id === 'string' &&
    Number.isFinite(item.lat) &&
    Number.isFinite(item.lon) &&
    Math.abs(item.lat) <= 90 &&
    Math.abs(item.lon) <= 180
  );
}

/**
 * A selectable layer of located public records. The source supplies plain
 * items; this owns markers, labels, occlusion, picking and refresh.
 */
export function createIntelPointLayer({
  id,
  name,
  icon,
  source,
  updateInterval = 0,
  shape = 'dot',
  kinds,
  fetchItems,
  onSelect,
  registerPickOwner = () => {},
  unregisterPickOwner = () => {},
}) {
  if (typeof fetchItems !== 'function')
    throw new TypeError(`${id} requires a source`);
  const prefix = `intel:${id}:`;
  let viewer = null;
  let billboards = null;
  let labels = null;
  let clickHandler = null;
  let removeCamera = [];
  let records = [];
  let byPick = new Map();
  let enabled = false;
  let request = null;
  let lastUpdate = null;
  let lastError = null;
  let stale = false;
  let rowListener = null;
  const hiddenKinds = new Set();

  const kindOf = (item) => kinds[item.kind] || Object.values(kinds)[0];
  const render = () => viewer?.scene?.requestRender?.();

  function clear() {
    billboards?.removeAll();
    labels?.removeAll();
    records = [];
    byPick = new Map();
  }

  function draw(items) {
    clear();
    for (const item of items) {
      if (!validItem(item)) continue;
      const kind = kindOf(item);
      const size = Math.max(12, Math.min(40, (item.weight || 5) * 3.4));
      const pick = prefix + item.id;
      const billboard = billboards.add({
        id: pick,
        position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, 0),
        image: marker(kind.color, kind.shape || shape),
        imageId: `${kind.shape || shape}:${kind.color}`,
        width: size,
        height: size,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(2e4, 1.1, 2.4e7, 0.5),
      });
      const record = { item, billboard, kind, sampled: false };
      records.push(record);
      byPick.set(pick, record);
    }
    refreshView();
  }

  /** Hide the far side, then label the heaviest records in view. */
  function refreshView() {
    if (!viewer || !enabled) return;
    const camera = viewer.camera;
    const occluder = new Cesium.EllipsoidalOccluder(
      Cesium.Ellipsoid.WGS84,
      camera.positionWC,
    );
    const height = camera.positionCartographic?.height ?? 1e7;
    const view = height < 8e6 ? camera.computeViewRectangle() : null;
    const visible = [];
    for (const record of records) {
      const shown =
        !hiddenKinds.has(record.item.kind) &&
        occluder.isPointVisible(record.billboard.position);
      record.billboard.show = shown;
      if (!shown) continue;
      if (view) {
        const spot = Cesium.Cartographic.fromDegrees(
          record.item.lon,
          record.item.lat,
        );
        if (!Cesium.Rectangle.contains(view, spot)) continue;
      }
      visible.push(record);
    }
    if (height < SURFACE_SAMPLE_HEIGHT_M && viewer.scene.sampleHeightSupported)
      settleOnSurface(visible);
    labels.removeAll();
    const floor = height > 6e6 ? 8 : height > 2e6 ? 6 : height > 5e5 ? 5 : 0;
    const named = visible
      .filter(({ item }) => item.badge || (item.weight || 0) >= floor)
      .sort((a, b) => (b.item.weight || 0) - (a.item.weight || 0));
    const taken = [...labelRects]
      .filter(([owner]) => owner !== id)
      .flatMap(([, rects]) => rects);
    const mine = [];
    for (const { item, billboard, kind } of named) {
      if (mine.length >= LABEL_CAP) break;
      const full = height < 1.6e6 || (item.weight || 0) >= 8;
      const text = full
        ? `${shortTitle(item.title)}${item.badge ? `  ${item.badge}` : ''}`
        : item.badge || '';
      if (!text) continue;
      const spot = Cesium.SceneTransforms.worldToWindowCoordinates(
        viewer.scene,
        billboard.position,
      );
      if (!spot) continue;
      const half = (text.length * CHARACTER_PX) / 2 + 8;
      const rect = {
        left: spot.x - half,
        right: spot.x + half,
        top: spot.y - 20 - LABEL_HEIGHT_PX / 2,
        bottom: spot.y - 20 + LABEL_HEIGHT_PX / 2,
      };
      if ([...taken, ...mine].some((other) => overlaps(rect, other))) continue;
      mine.push(rect);
      labels.add({
        id: prefix + item.id,
        position: billboard.position,
        text,
        font: '500 11px "JetBrains Mono", monospace',
        fillColor: Cesium.Color.fromCssColorString('#e9f6ff'),
        outlineColor: Cesium.Color.fromCssColorString('#04080f'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString(kind.color).withAlpha(
          0.16,
        ),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        pixelOffset: new Cesium.Cartesian2(0, -20),
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
    labelRects.set(id, mine);
    render();
  }

  /** Close views sit on 3D terrain, so nearby markers move up onto it. */
  function settleOnSurface(visible) {
    let budget = SURFACE_SAMPLE_CAP;
    for (const record of visible) {
      if (record.sampled || budget-- <= 0) continue;
      try {
        const spot = Cesium.Cartographic.fromDegrees(
          record.item.lon,
          record.item.lat,
        );
        const ground = viewer.scene.sampleHeight(spot);
        if (!Number.isFinite(ground)) continue;
        record.sampled = true;
        record.billboard.position = Cesium.Cartesian3.fromDegrees(
          record.item.lon,
          record.item.lat,
          ground + 4,
        );
      } catch {
        return;
      }
    }
  }

  return {
    id,
    name,
    icon,
    source,
    updateInterval,
    init(activeViewer) {
      if (viewer) throw new Error(`${id} is already initialized`);
      viewer = activeViewer;
      billboards = viewer.scene.primitives.add(
        new Cesium.BillboardCollection({ scene: viewer.scene }),
      );
      labels = viewer.scene.primitives.add(
        new Cesium.LabelCollection({ scene: viewer.scene }),
      );
      billboards.show = labels.show = false;
      clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      clickHandler.setInputAction((event) => {
        if (!enabled) return;
        const picked = viewer.scene.pick(event.position);
        const record = byPick.get(picked?.id);
        if (record) onSelect?.({ layerId: id, layerName: name, ...record });
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      registerPickOwner(id, (pickedId) => String(pickedId).startsWith(prefix));
      removeCamera = [
        viewer.camera.moveEnd.addEventListener(refreshView),
        viewer.camera.changed.addEventListener(refreshView),
      ];
    },
    enable() {
      enabled = true;
      billboards.show = labels.show = true;
      if (records.length) refreshView();
    },
    disable() {
      enabled = false;
      request?.abort();
      request = null;
      if (billboards) billboards.show = false;
      if (labels) labels.show = false;
      labelRects.delete(id);
      render();
    },
    async update() {
      if (!enabled) return false;
      // Bundled records never change while the page is open.
      if (!updateInterval && records.length) return true;
      request?.abort();
      const current = new AbortController();
      request = current;
      try {
        const result = await fetchItems({ signal: current.signal });
        if (current.signal.aborted || !enabled) return false;
        draw(result.items || []);
        stale = result.stale === true;
        lastUpdate = result.updatedAt || Date.now();
        lastError = null;
        rowListener?.();
        return true;
      } catch (error) {
        if (current.signal.aborted) return false;
        lastError = error?.message || 'Source unavailable';
        rowListener?.();
        return false;
      } finally {
        if (request === current) request = null;
      }
    },
    destroy(activeViewer = viewer) {
      enabled = false;
      request?.abort();
      request = null;
      clickHandler?.destroy();
      clickHandler = null;
      for (const remove of removeCamera) remove();
      removeCamera = [];
      unregisterPickOwner(id);
      labelRects.delete(id);
      clear();
      if (activeViewer && !activeViewer.isDestroyed?.()) {
        if (billboards) activeViewer.scene.primitives.remove(billboards);
        if (labels) activeViewer.scene.primitives.remove(labels);
      }
      billboards = labels = null;
      viewer = null;
    },
    /** Fly-to support for the World Desk: find one record by id. */
    findItem(itemId) {
      return byPick.get(prefix + itemId)?.item || null;
    },
    getAnalystRecords(maxCount = 500) {
      if (!enabled) return [];
      return records.slice(0, maxCount).map(({ item }) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        lat: item.lat,
        lon: item.lon,
        source: item.source || source,
        ...Object.fromEntries(item.details || []),
      }));
    },
    getRowControls() {
      const entries = Object.entries(kinds);
      if (entries.length < 2) return null;
      const counts = new Map();
      for (const { item } of records)
        counts.set(item.kind, (counts.get(item.kind) || 0) + 1);
      return {
        chips: entries
          .filter(([kind]) => counts.get(kind))
          .map(([kind, { label }]) => ({
            id: kind,
            label: `${label} ${counts.get(kind)}`,
            active: !hiddenKinds.has(kind),
            title: `Show or hide ${label.toLowerCase()}`,
            onClick: () => {
              if (hiddenKinds.has(kind)) hiddenKinds.delete(kind);
              else hiddenKinds.add(kind);
              refreshView();
              rowListener?.();
            },
          })),
        legend: [],
      };
    },
    setRowControlsListener(listener) {
      rowListener = typeof listener === 'function' ? listener : null;
    },
    getStats() {
      return {
        count: records.length,
        lastUpdate,
        error: lastError,
        ...(stale ? { stale: true } : {}),
      };
    },
  };
}
