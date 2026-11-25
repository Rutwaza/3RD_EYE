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
- **World Desk:** Ranked headlines from 35 newsrooms (IGIHE, The New Times, CNN,
  BBC, Reuters and others) with hotspots, trends, expected events, markets, live
  TV, a watchlist and alerts. Press `N`.
- **Africa layers:** East African hospitals, border posts, ports, mines and
  refugee sites; airports, power plants, weather and air quality, river levels,
  earthquakes, volcanoes, economies and displacement.
- **World pulse:** News, disaster alerts and disease outbreaks on the globe.
- **Live tracking:** View aircraft, military ADS-B tracks, ships, satellites,
  earthquakes, active fires, and space launches. Select an item to see available details and follow its movement.
- **Aircraft cockpit:** Track an aircraft, enter cockpit mode, and move between
  nearby contacts.
- **Camera layer:** Browse supported public camera feeds, locate nearby
  cameras, and project a selected view into the globe. Camera direction and
  coverage are estimates and can be calibrated.
- **Traffic and routes:** Animate traffic over mapped roads, show live flow
  speeds when configured, draw routes, and fly the camera along a route.
- **Visual tools:** Frame the map in a circle or show it wide, use the HUD and
  detection overlay, and draw pins, lines and areas with DISPLAY ▸ **Draw**.
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
5. Use DISPLAY controls to draw a pin, line, or area.
   Use Directions to create a route.
6. Open SCENES to capture and play camera shots, or use the share control to
   send the current view.
7. If voice is configured, select **GEV MIC**, allow microphone access, and
   speak a supported command.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `N` | Open or close the World Desk |
| `G` | Return to the globe |
| `H` | Toggle the HUD |
| `D` | Toggle the detection overlay |
| `C` | Enter or leave aircraft cockpit mode when available |
| `Esc` | Exit the active mode or dismiss an interaction |

## Self-deployed cameras and Face Map

The CCTV panel connects up to 64 operator-owned HTTP MJPEG cameras. Names, URLs
and coordinates stay in this browser. Do not put credentials in a stream URL.
The camera must allow the app origin through CORS. For the AI-Thinker ESP32-CAM,
see [`docs/hardware/esp32_cam_face_map.ino`](docs/hardware/esp32_cam_face_map.ino).

**Face Map** analyses one selected camera, or this computer's own camera, on this
machine:

1. **People.** A detector finds each person and tracks them between frames.
2. **Faces.** Each person's upper body is enlarged and searched for a face.
3. **Quality.** Faces that are too small (under 80 px), turned, blurred, or that
   look like a photo or screen are not compared.
4. **Match.** The face is compared with the local database. A result close to
   two different people is treated as ambiguous.
5. **Vote.** Three agreeing frames are needed before a candidate is named.
6. **Review.** A person confirms or rejects each candidate in the LOG tab.

Enroll only people who agreed, with one to eight photos and a category
(authorised, visitor, or person of interest for pilot volunteers). Frames and
photos are never saved. The loopback-only service keeps face templates, a 30-day
log of candidate sightings and a hash-chained audit trail in
`~/.gods-eye-view/face-identities/`. These files are not encrypted, so protect
the account. People who are not enrolled are never recorded. Deleting a person
deletes their sightings.

Scores are model similarity, not a probability of identity. The cutoff is not
calibrated against a representative set, and liveness checks can be fooled. Do
not act on a candidate without human review.

## Development

```bash
npm run build       # Create a production build
npm run test        # Run the unit test suite
npm run doctor      # Check local setup and provider configuration
```

## Credits

3RD EYE is built on the open-source God's Eye View by Bilawal Sidhu and
contributors (MIT). The original notice is kept in [LICENSE](LICENSE).

## Data and license

Application code is released under the [MIT License](LICENSE). Data sources
and bundled datasets may have separate terms and attribution requirements;
check [DATA_SOURCES.md](DATA_SOURCES.md) before redistributing them.

## Maintainer

**Rutwaza** · [GitHub](https://github.com/Rutwaza)
