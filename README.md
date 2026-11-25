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

1. On a fresh launch, the globe flies to Kigali Convention Centre in Kigali,
   Rwanda. Choose a first-run option or search for another place to change the
   view.
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

## Self-deployed cameras and local face matching

The CCTV panel can connect to up to 64 operator-provided HTTP MJPEG cameras.
Camera names, stream URLs, and coordinates are stored in this browser's local
storage. Do not put credentials in a stream URL. The camera must allow the app
origin through CORS so the browser can read frames for local analysis.

The **Face Map** panel runs the Human FaceRes model in a browser worker.
It samples the selected self-deployed camera once per second, at up to 1280
pixels wide. Matching and enrollment run on the local device; camera frames
and reference photos are not uploaded or saved by the face service. The
loopback-only local API stores enrollment names, consent timestamps, and face
embeddings in `~/.gods-eye-view/face-identities/identities-v1.json`. This file
is not encrypted, so protect access to the local account and its files. Face Map
shows the registered identity and template totals, refreshing when the panel is
opened, when you return to the app, and after enrollment or deletion. The
local API is available through `npm run dev` and `npm run preview`; a static
build deployment does not include the API.

For better input quality, the app rejects faces with a box smaller than 224
pixels or detection scores below 0.7. Enroll one to eight clear photos only
with the person's agreement. Results are possible candidates for human review.
The displayed score is a normalized model similarity score, not a probability
or confirmation of identity. The current cutoff is configurable but has not
been calibrated against a representative evaluation set; do not treat it as
a validated security threshold. This feature does not perform liveness checks.
New enrollments are compared with the local database. A score of 90/100 or
higher raises a possible-duplicate prompt; it is a review warning, not proof
that two photos show the same person. The panel reports registered identities
and reference templates separately.

To use it, enable **Self deployed cameras**, add an HTTP MJPEG stream with its
location, open **Face Map**, enroll consented reference photos, select
the camera, and press **Start**. Stop analysis when it is no longer needed and
delete enrollments when they are no longer authorized.

For the common AI-Thinker ESP32-CAM board, see
[`docs/hardware/esp32_cam_face_map.ino`](docs/hardware/esp32_cam_face_map.ino)
for a matching MJPEG firmware sketch and upload instructions. Other ESP32-CAM
board variants need their own camera pin map.

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
