import {
  createOpenSkySource,
  createAdsbLolSource,
  createAisStreamSource,
} from '../sources/live/standalone.js';
import { createCctvSource } from '../layers/cctv/source.js';
import { createRadioSource } from '../layers/radio/source.js';
import { createTrafficSource } from '../layers/traffic/source.js';
import { createSelfDeployedCameraStore } from '../layers/selfDeployedCameras/store.js';
import { createIntelSource } from '../layers/intel/index.js';
import { createInstallationSource } from '../layers/installations/source.js';
import { createSatelliteSource } from '../layers/satellites/source.js';
import { createLaunchSource } from '../layers/launches/source.js';
import { createFirmsSource } from '../layers/firms/source.js';
import { createReferenceSources } from '../sources/reference.js';
export { createReferenceSources as createStandaloneReferenceSources } from '../sources/reference.js';

/** Select standalone providers without starting their acquisition. */
export function createStandaloneLayerSources() {
  return {
    ...createReferenceSources(),
    flights: createOpenSkySource(),
    military: createAdsbLolSource(),
    vessels: createAisStreamSource({
      apiUrl: import.meta.env?.VITE_AIS_LIVE_API_URL || '/api/ais-live',
    }),
    cctv: createCctvSource(),
    radio: createRadioSource(),
    traffic: createTrafficSource(),
    selfDeployedCameras: createSelfDeployedCameraStore(),
    installations: createInstallationSource(),
    satellites: createSatelliteSource(),
    launches: createLaunchSource(),
    firms: createFirmsSource(),
    intel: createIntelSource(),
  };
}
