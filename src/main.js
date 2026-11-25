import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { mountWorldDesk } from './ui/news/index.js';

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

const internetStatus = document.getElementById('style-indicator');
const updateInternetStatus = () => {
  const online = navigator.onLine;
  if (!internetStatus) return;
  internetStatus.classList.toggle('is-offline', !online);
  internetStatus.setAttribute(
    'aria-label',
    online ? 'Internet connected' : 'No internet connection',
  );
};
window.addEventListener('online', updateInternetStatus);
window.addEventListener('offline', updateInternetStatus);
updateInternetStatus();

application
  .start()
  .then(() => {
    const { scene, controls, data } = application.getComponents();
    const unmount = mountWorldDesk({
      viewer: scene.viewer,
      styleManager: controls.styleManager,
      dataManager: data.dataManager,
    });
    application.subscribe(({ status }) => {
      if (status === 'destroying' || status === 'destroyed') unmount();
    });
  })
  .catch((error) => {
    console.error('3rd Eye initialization failed:', error);
    const loaderStatus = document.querySelector(
      '#loading-screen .loader-status',
    );
    loaderStatus.textContent = `Error: ${describeError(error)}`;
    loaderStatus.style.color = '#ff4444';
  });

export { application };
