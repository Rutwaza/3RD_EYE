import * as Cesium from 'cesium';

/**
 * Camera presets for notable locations.
 */
export const CAMERA_PRESETS = {
  austin: {
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 800),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0.0,
    },
  },
  sf: {
    destination: Cesium.Cartesian3.fromDegrees(-122.4194, 37.7749, 1000),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
  nyc: {
    destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200),
    orientation: {
      heading: Cesium.Math.toRadians(-20),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
};

/**
 * Fly the camera to a preset location with a smooth animation.
 */
export function flyToPreset(viewer, presetName, duration = 3.0) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Set the fresh-start camera to the requested Kigali view.
 * @returns {Function} Cancels any active camera flight during teardown.
 */
export function flyToKigali(viewer) {
  // Match the default projection encoded by the requested share link.
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(30.1093, -1.9774, 4012),
    orientation: {
      heading: Cesium.Math.toRadians(360),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
  });

  return () => {
    if (!viewer.isDestroyed()) viewer.camera.cancelFlight();
  };
}
