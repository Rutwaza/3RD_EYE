import * as Cesium from 'cesium';

// Attribution and service rights are documented in DATA_SOURCES.md.
export const ESRI_ATTRIBUTION_HTML =
  '<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a>';

export function createOsmImagery() {
  return new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
    credit: '© OpenStreetMap contributors',
  });
}

export function createEsriImagery() {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    {
      credit:
        'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      enablePickFeatures: false,
    },
  );
}

export function createIonImagery(style, accessToken) {
  accessToken = String(accessToken || '').trim();
  if (!accessToken) throw new Error('Ion imagery requires an explicit token');
  return Cesium.IonImageryProvider.fromAssetId(style, { accessToken });
}

/** Build the labeled Google Maps Roadmap raster source using a Map Tiles session. */
export async function createGoogleRoadmapImagery(
  apiKey,
  { viewer, signal, fetchImpl = (...args) => globalThis.fetch(...args) } = {},
) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Google Maps Roadmap requires a Google Maps API key');
  signal?.throwIfAborted();
  const sessionResponse = await fetchImpl(
    `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType: 'roadmap', language: 'en', region: 'RW' }),
      signal,
    },
  );
  if (!sessionResponse.ok) throw new Error('Google Maps Roadmap session unavailable; check Map Tiles API and billing');
  const session = await sessionResponse.json();
  signal?.throwIfAborted();
  if (typeof session?.session !== 'string' || !session.session)
    throw new Error('Google Maps returned an invalid Roadmap session');

  const provider = new Cesium.UrlTemplateImageryProvider({
    url: `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session.session)}&key=${encodeURIComponent(key)}`,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    tileWidth: Number(session.tileWidth) || 256,
    tileHeight: Number(session.tileHeight) || 256,
    maximumLevel: 22,
  });
  let attributionRequest = 0;
  provider.getMapAttribution = async () => {
    const requestId = ++attributionRequest;
    const rectangle = viewer?.camera?.computeViewRectangle?.(viewer.scene.globe.ellipsoid);
    if (!rectangle) return '<span>Google Maps</span>';
    const south = Cesium.Math.toDegrees(rectangle.south);
    const north = Cesium.Math.toDegrees(rectangle.north);
    const west = Cesium.Math.toDegrees(rectangle.west);
    const east = Cesium.Math.toDegrees(rectangle.east);
    const longitudeSpan = east >= west ? east - west : 360 - west + east;
    const screenWidth = Math.max(256, Number(viewer.container?.clientWidth) || 1024);
    const zoom = Math.max(0, Math.min(22, Math.round(Math.log2(screenWidth * 360 / (256 * Math.max(0.001, longitudeSpan))))));
    const params = new URLSearchParams({
      session: session.session,
      key,
      zoom: String(zoom),
      north: String(north),
      south: String(south),
      east: String(east),
      west: String(west),
    });
    const response = await fetchImpl(`https://tile.googleapis.com/tile/v1/viewport?${params}`, { signal });
    if (!response.ok) throw new Error('Google Maps attribution is temporarily unavailable');
    const metadata = await response.json();
    if (requestId !== attributionRequest) return null;
    const copyright = String(metadata?.copyright || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
    return copyright
      ? `<span>Google Maps</span> · ${copyright}`
      : '<span>Google Maps</span>';
  };
  return provider;
}
