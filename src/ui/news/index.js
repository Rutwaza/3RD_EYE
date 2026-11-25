import * as Cesium from 'cesium';
import { INTEL_SELECTED_EVENT } from '../../layers/intel/index.js';
import { createDeskStore } from './deskStore.js';
import { IntelCard } from './intelCard.js';
import { WorldDesk } from './worldDesk.js';

/** Layers the Africa workspace turns on; everything else stays as it was. */
const AFRICA_LAYERS = [
  'world-news',
  'africa-environment',
  'africa-seismic',
  'africa-volcanoes',
];
const EAST_AFRICA_VIEW = { lat: -1.5, lon: 33.2, height: 3_900_000 };

/** Join the World Desk to the globe. Returns a cleanup function. */
export function mountWorldDesk({ viewer, styleManager, dataManager }) {
  const root = document.getElementById('world-desk');
  if (!root) return () => {};

  const store = createDeskStore();

  function fly(lat, lon, height) {
    const go = () => {
      viewer.trackedEntity = undefined;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
        duration: 2.2,
      });
      return true;
    };
    if (typeof styleManager?._runExplicitNavigation === 'function')
      styleManager._runExplicitNavigation('destination', go);
    else go();
  }

  async function enable(id) {
    try {
      await dataManager.setEnabled(id, true, { origin: 'user' });
    } catch (error) {
      console.warn(`[World Desk] ${id} could not be enabled:`, error);
    }
  }

  const card = new IntelCard({
    root: document.getElementById('intel-card'),
    onFly: (place) => fly(place.lat, place.lon, 900_000),
    onOpenDesk: () => desk.setOpen(true),
    onRead: (id) => store.markRead(id),
  });

  const scopeButton = document.getElementById('scope-toggle');
  const circleOn = () => scopeButton?.classList.contains('active') === true;

  const desk = new WorldDesk({
    store,
    actions: {
      closeCard: () => card.hide(),
      flyToPlace(place) {
        fly(place.lat, place.lon, 2_600_000);
        void enable('world-news');
      },
      flyToStory(story) {
        fly(story.place.lat, story.place.lon, 2_600_000);
        void enable('world-news');
        card.showStory(story);
      },
      showStory(story) {
        if (desk.open) desk.setOpen(false);
        card.showStory(story);
      },
      openAfrica() {
        fly(
          EAST_AFRICA_VIEW.lat,
          EAST_AFRICA_VIEW.lon,
          EAST_AFRICA_VIEW.height,
        );
        for (const id of AFRICA_LAYERS) void enable(id);
      },
      setFraming(view) {
        if ((view === 'circle') !== circleOn()) scopeButton?.click();
        desk.syncFraming(circleOn());
      },
    },
  });

  const observer = new MutationObserver(() => desk.syncFraming(circleOn()));
  if (scopeButton)
    observer.observe(scopeButton, {
      attributes: true,
      attributeFilter: ['class'],
    });
  desk.syncFraming(circleOn());

  const onSelected = (event) => card.showRecord(event.detail);
  window.addEventListener(INTEL_SELECTED_EVENT, onSelected);
  store.start();

  return () => {
    window.removeEventListener(INTEL_SELECTED_EVENT, onSelected);
    observer.disconnect();
    desk.destroy();
    card.hide();
    store.destroy();
  };
}
