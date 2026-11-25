import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { flyToKigali } from '../camera.js';

test('fresh-start camera uses the configured Kigali projection', () => {
  let view;
  let flights = 0;
  let cancelled = 0;
  const viewer = {
    isDestroyed: () => false,
    camera: {
      setView(value) {
        view = value;
      },
      flyTo() {
        flights++;
      },
      cancelFlight() {
        cancelled++;
      },
    },
  };
  const stop = flyToKigali(viewer);
  assert.deepEqual(view.destination, Cesium.Cartesian3.fromDegrees(30.1093, -1.9774, 4012));
  assert.equal(view.orientation.heading, Cesium.Math.toRadians(360));
  assert.equal(view.orientation.pitch, Cesium.Math.toRadians(-90));
  assert.equal(view.orientation.roll, 0);
  assert.equal(flights, 0);
  stop();
  assert.equal(cancelled, 1);
});
