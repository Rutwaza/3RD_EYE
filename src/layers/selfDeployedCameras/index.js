import * as Cesium from 'cesium';

/** User-managed ESP32/MJPEG cameras, visible only while this layer is enabled. */
export function createSelfDeployedCamerasLayer({ store }) {
  if (!store?.list || !store?.subscribe || !store?.setEnabled)
    throw new TypeError('A self-deployed camera store is required');
  let viewer = null;
  let dataSource = null;
  let clickHandler = null;
  let unsubscribe = null;

  function renderCameras() {
    if (!dataSource) return;
    dataSource.entities.removeAll();
    for (const camera of store.list()) {
      const entity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, 0),
        point: {
          pixelSize: 12,
          color: Cesium.Color.fromCssColorString('#4dd7ed'),
          outlineColor: Cesium.Color.fromCssColorString('#07131b'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: camera.name,
          font: '11px monospace',
          fillColor: Cesium.Color.fromCssColorString('#d9fbff'),
          outlineColor: Cesium.Color.fromCssColorString('#07131b'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
            0,
            1_500_000,
          ),
        },
      });
      entity.selfDeployedCameraId = camera.id;
    }
    dataSource.show = store.isEnabled();
    viewer?.scene?.requestRender?.();
  }

  return {
    id: 'self-deployed-cameras',
    name: 'Self deployed cameras',
    icon: '📷',
    source: 'User-managed HTTP MJPEG streams',
    updateInterval: 0,
    async init(activeViewer) {
      if (viewer)
        throw new Error('Self deployed cameras are already initialized');
      viewer = activeViewer;
      dataSource = new Cesium.CustomDataSource('self-deployed-cameras');
      await viewer.dataSources.add(dataSource);
      clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      clickHandler.setInputAction((event) => {
        if (!store.isEnabled()) return;
        const picked = viewer.scene.pick(event.position);
        const cameraId = picked?.id?.selfDeployedCameraId;
        if (cameraId) store.select(cameraId, 'map');
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      unsubscribe = store.subscribe(renderCameras);
      renderCameras();
    },
    enable() {
      store.setEnabled(true);
      renderCameras();
    },
    disable() {
      store.setEnabled(false);
      if (dataSource) dataSource.show = false;
    },
    async update() {},
    getStats() {
      return { count: store.list().length };
    },
    destroy(activeViewer = viewer) {
      store.setEnabled(false);
      unsubscribe?.();
      unsubscribe = null;
      clickHandler?.destroy();
      clickHandler = null;
      if (dataSource && activeViewer)
        activeViewer.dataSources.remove(dataSource, true);
      dataSource = null;
      viewer = null;
    },
  };
}
