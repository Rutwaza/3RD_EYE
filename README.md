# 3RD EYE OSINT

**Maintainer: Rutwaza** · [GitHub repository](https://github.com/Rutwaza/3RD_EYE)

3RD EYE OSINT is a browser-based globe for exploring public geospatial data.
It combines live and periodically refreshed feeds with maps, camera views,
tracking, voice controls, and scene tools.

> Data can be delayed, incomplete, estimated, or unavailable. This project is
> for exploration and visualization, not navigation, emergency response, or
> other safety-critical decisions.

## Features

- **3D globe and maps:** Explore satellite imagery, terrain, and optional
  photorealistic 3D city tiles. Keyless map options are available.
- **Live tracking:** View aircraft, military ADS-B tracks, ships, satellites,
  transit, bike-share availability, earthquakes, active fires, and space
  launches. Select an item to see available details and follow its movement.
- **Aircraft cockpit:** Track an aircraft, enter cockpit mode, and move between
  nearby contacts.
- **Camera layer:** Browse supported public camera feeds, locate nearby
  cameras, and project a selected view into the globe. Camera direction and
  coverage are estimates and can be calibrated.
- **Traffic and routes:** Animate traffic over mapped roads, show live flow
  speeds when configured, draw routes, and fly the camera along a route.
- **Visual tools:** Switch sensor-inspired color styles, use the HUD and
  detection overlay, and draw geographic pins, lines, and areas.
- **Voice controls:** With an OpenAI API key, ask questions about the current
  view and use supported voice commands to navigate, control layers, and draw.
- **Scenes and sharing:** Capture camera positions into a scene, play them
  back, and share a link containing supported view settings.
- **Infrastructure context:** Explore mapped installations, dams, data
  centers, submarine cables, and other bundled or public geographic data.

### How it works

The browser app uses CesiumJS to render the globe and Vite to serve the app
during development. Each data layer retrieves information from its configured
source, converts it to map features, and refreshes independently. Some layers
use the local server as a proxy so provider credentials stay out of the
browser. Optional API keys unlock additional providers; they are not required
to start the app.

Traffic vehicles are simulated. Satellite positions, camera directions,
viewsheds, and some trajectories are calculated estimates. Style filters and
detection graphics are visual overlays, not additional sensors.

## Setup

### Requirements

- Git
- Node.js **24.14 or later in the 24.x line, or 26.x**
- npm (included with Node.js)

### Run locally

```bash
git clone https://github.com/Rutwaza/3RD_EYE.git
cd 3RD_EYE
npm ci
npm run doctor
npm run dev
```

Open the local address printed by Vite (by default, `http://localhost:4173`).
The app starts with keyless sources. Keep the development server on localhost
unless you have secured the network access and configured provider limits.

### Optional API keys

Use the **POWER UP** panel in the app to see and configure supported
providers. Depending on the layer, keys can enable photorealistic maps, live
ships, active fires, live traffic flow, or voice. Provider quotas, pricing,
and terms apply. Never commit `.env` or other files containing credentials.
See [`.env.example`](.env.example), [SECURITY.md](SECURITY.md), and
[DATA_SOURCES.md](DATA_SOURCES.md) for configuration, security, and source
details.

## Using the app

1. Choose a first-run option or search for a place.
2. Open the layer controls and enable the data you want to see.
3. Click a marker to inspect it and follow its updates. For aircraft, select
   **COCKPIT** to ride along; use the contacts controls to switch aircraft.
4. Use the CCTV panel to select a public camera or find one nearby. Adjust its
   estimated orientation with the calibration controls when available.
5. Use DISPLAY controls to change visual style or draw a pin, line, or area.
   Use Directions to create a route.
6. Open SCENES to capture and play camera shots, or use the share control to
   send the current view.
7. If voice is configured, select **GEV MIC**, allow microphone access, and
   speak a supported command.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `1`–`7` | Change visual style |
| `H` | Toggle the HUD |
| `D` | Toggle the detection overlay |
| `C` | Enter or leave aircraft cockpit mode when available |
| `Esc` | Exit the active mode or dismiss an interaction |

## Camera expansion plan: self-hosted cameras

The current camera layer uses supported public camera sources. Connecting
operator-owned cameras is a future expansion; it is not currently implemented.

The proposed design is to run a small gateway on the camera owner's network.
It would connect to explicitly enrolled RTSP or ONVIF cameras and provide an
authenticated API for the app. A separate source adapter would translate
camera IDs, operator-supplied labels and locations, health, and authorized
frames into the existing camera layer. Private camera links and credentials
should stay private and should not be added to shared URLs by default.

Any future video analysis should remain local to that gateway and focus on
non-identifying events, such as motion or vehicle presence. The project will
not add face recognition, named-person search, or individual tracking. A
deployment should include authentication, encrypted connections, network
allowlists, limited retention, access logs, a visible processing status, and
clear camera enrollment and removal controls.

Suggested implementation order:

1. Define and secure the local gateway API.
2. Test it with an operator-owned camera on a private network.
3. Add an opt-in camera source adapter and health status.
4. Reuse the globe's existing selection, projection, and calibration UI.
5. Document deployment, privacy, retention, and camera revocation.

## Development

```bash
npm run build       # Create a production build
npm run test        # Run the unit test suite
npm run doctor      # Check local setup and provider configuration
```

## Data and license

Application code is released under the [MIT License](LICENSE). Data sources
and bundled datasets may have separate terms and attribution requirements;
check [DATA_SOURCES.md](DATA_SOURCES.md) before redistributing them.

## Maintainer

**Rutwaza** · [GitHub](https://github.com/Rutwaza)
