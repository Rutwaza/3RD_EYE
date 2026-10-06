import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

const internetStatus = document.getElementById('internet-status-value');
const updateInternetStatus = () => {
  const online = navigator.onLine;
  if (!internetStatus) return;
  internetStatus.textContent = online ? 'ONLINE' : 'OFFLINE';
  internetStatus.closest('#style-indicator')?.classList.toggle('is-offline', !online);
  internetStatus.setAttribute('aria-label', online ? 'Internet connected' : 'No internet connection');
};
window.addEventListener('online', updateInternetStatus);
window.addEventListener('offline', updateInternetStatus);
updateInternetStatus();

application.start().catch((error) => {
  console.error('3rd Eye initialization failed:', error);
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  loaderStatus.textContent = `Error: ${describeError(error)}`;
  loaderStatus.style.color = '#ff4444';
});

export { application };
