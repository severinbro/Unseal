# Entsiegelungskartierung — Open-Source Ground-Unsealing PPGIS

**Entsiegelungskartierung** is an open-source Public Participation Geographic Information System (PPGIS) for **Android, iOS, and Web**. Citizens map impervious ground surfaces ("ground sealing", such as asphalt parking corners, concrete courtyards, and paved street margins) proposed for unsealing, and prioritize proposals through `+1` / `-1` community voting.

Unauthenticated visitors can explore OpenStreetMap vector basemaps, toggle `EPSG:3857` aerial orthophotos beneath proposal geometries, center on their GPS position, inspect proposals, and export all proposals as RFC 7946 GeoJSON (`GET /api/v1/polygons/export.geojson`) for direct analysis in QGIS or desktop GIS tools. Contributors register zero-PII pseudonymous accounts (unique `pseudonym`, password, and one-time 32-hex recovery code — no email address, phone number, or real name) to draw validated polygons and vote.

---

## Architecture & Monorepo Layout

```mermaid
flowchart LR
  subgraph Client["apps/mobile (Expo Android / iOS / Web — MPL-2.0)"]
    UI["UI Sheets, Pure Reducers & View-Models"]
    MC["MapCanvas (.native.tsx / .web.tsx)"]
    UI --> MC
  end
  subgraph Shared["packages/shared (Compiled ESM — MPL-2.0)"]
    ZOD["Canonical Zod Wire Schemas, Errors & Draft Validator"]
  end
  PROXY["External TLS Reverse Proxy (HTTPS + Static Expo Web)"]
  subgraph Backend["Docker Compose Stack (2 Containers)"]
    API["apps/api (Fastify /api/v1 — AGPL-3.0-or-later)"]
    DB[("PostgreSQL 16 + PostGIS 3.4")]
    API --> DB
  end
  Tiles["Configurable OSM Vector Style & EPSG:3857 Orthophoto Tiles"]
  UI -. imports .-> ZOD
  API -. imports .-> ZOD
  UI <-->|"HTTPS JSON / GeoJSON + Bearer Session"| PROXY
  PROXY --> API
  MC -->|"HTTPS Tile GET"| Tiles
```

* **`packages/shared` (`MPL-2.0`):** Compiled ESM package (`dist/`) exporting `camelCase` Zod request/response schemas, `ErrorCode` + `ApiError`, and client-side single-ring polygon pre-checks (`@turf/area`, `@turf/kinks`, consecutive duplicate tap deduplication, and `< 2°` fold-back spike detection).
* **`apps/api` (`AGPL-3.0-or-later`):** Single-replica compiled Fastify `/api/v1` service backed by PostgreSQL 16 + PostGIS 3.4 (`ST_IsValidDetail`, ellipsoid `ST_Area(geom::geography)` within `2–500,000 m²`, `ST_ForcePolygonCCW`), Argon2id password hashing gated by a bounded semaphore (`4` concurrent / `20` queued), `SHA-256` opaque bearer sessions and recovery codes, IPv6 `/64`-normalized rate limiting, Pino structured logging with secret redaction and omitted client IP addresses, and the `admin.ts` moderation CLI.
* **`apps/mobile` (`MPL-2.0`):** Expo SDK 52 application targeting Android, iOS, and Web, localized in German (`de`, default) and English (`en`) with an inline `DE | EN` language switcher (`src/i18n/translations.ts`). Platform-specific MapLibre (`MapCanvas.native.tsx` / `MapCanvas.web.tsx`), session token storage (`secureStorage.native.ts` / `secureStorage.web.ts`), and GPS location (`locateMe.native.ts` / `locateMe.web.ts`) live behind `.native` and `.web` module suffixes, keeping reducers and view-models pure TypeScript.
* **`test/e2e-flow.test.ts`:** Root full-stack integration suite exercising `PpgisApiClient`, `appReducer`, and UI view-models over live HTTP against Fastify + PostGIS without coupling `apps/mobile` dependencies to `apps/api`.

---

## Quick Start (Docker Compose & Local Development)

### Prerequisites

* **Node.js `>= 24.0.0`** and `npm`
* **Docker Engine** with **Docker Compose v2**

### 1. Start the 2-Container Backend Stack (`postgis` + `api`)

```bash
cp .env.example .env
docker compose up -d --build
```

On startup, the `api` container automatically applies numbered SQL migrations from `apps/api/migrations/` under a PostgreSQL advisory lock before binding `0.0.0.0:3000` (mapped to `127.0.0.1:3000` on the host).

Verify readiness and runtime configuration:

```bash
curl -fsS http://127.0.0.1:3000/api/v1/health
curl -fsS http://127.0.0.1:3000/api/v1/config
```

### 2. Install Workspace Dependencies, Build, Typecheck, and Test

```bash
npm ci
npm run build
npm run typecheck
npm test
```

* `npm test` automatically starts the `postgis` service via `docker compose up -d --wait postgis` unless `SKIP_DOCKER_PRETEST=1` is set (useful in CI environments that provision an external PostGIS service container).

---

## Production Deployment & Reverse Proxy Configuration

In production, `docker-compose.yml` binds PostGIS (`127.0.0.1:5432`) and Fastify (`127.0.0.1:3000`) strictly to loopback. Place an external TLS reverse proxy (such as **Caddy**, **Nginx**, or **Traefik**) in front of `127.0.0.1:3000` to:

1. **Terminate HTTPS (`TLS 1.2+`):** Required for browser `navigator.geolocation` ("Locate me" requires a secure `https://` context) and mobile App Transport Security / cleartext policies.
2. **Set `TRUST_PROXY=true` and `CORS_ORIGIN=https://map.example.org` in `.env`:** Ensures `@fastify/rate-limit` reads the forwarded client IP from your trusted reverse proxy rather than `127.0.0.1`, and restricts cross-origin browser requests to your domain. Keep `apps/api` as a **single replica** in v1 (rate-limit caches and concurrency semaphores are per-process).
3. **Host Static Expo Web Assets:** Export the static web bundle and serve it from the same origin (or a configured `CORS_ORIGIN`):

```bash
npx --workspace apps/mobile expo export --platform web --output-dir dist-web
```

### Disabling Reverse-Proxy Client IP Access Logs (GDPR Data Minimization)

`apps/api` omits `remoteAddress` from Pino logs by design and uses client IP subnets strictly in transient in-memory rate-limit counters. To maintain end-to-end IP minimization, disable client IP access logging in your reverse proxy as well.

### Recommended Content-Security-Policy (CSP) & Example Caddyfile

MapLibre GL JS (`maplibre-gl`) spawns Web Workers from `blob:` URLs on Expo Web, so your CSP must permit `worker-src 'self' blob:` and tile/API HTTPS origins:

```caddyfile
map.example.org {
    log {
        output discard
    }

    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "geolocation=(self), camera=(), microphone=()"
        Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tiles.openfreemap.org https://ortho.example.org; connect-src 'self' https://tiles.openfreemap.org https://ortho.example.org; worker-src 'self' blob:; font-src 'self' data: https://tiles.openfreemap.org; frame-ancestors 'none'"
    }

    handle /api/* {
        reverse_proxy 127.0.0.1:3000
    }

    handle {
        root * /srv/entsiegelung/dist-web
        try_files {path} /index.html
        file_server
    }
}
```

*(For Nginx, set `access_log off;` inside the `server` block, proxy `/api/` to `http://127.0.0.1:3000` with `proxy_set_header X-Forwarded-For $remote_addr;`, and add the same `Content-Security-Policy` header.)*

---

## Basemap (`PMTiles`) & Municipal Orthophoto (`WMS` / `XYZ`) Setup

### Vector Basemap (`OSM_STYLE_URL` & Self-Hosted `PMTiles`)

* By default, `OSM_STYLE_URL` points to OpenFreeMap Liberty (`https://tiles.openfreemap.org/styles/liberty`). Never point `OSM_STYLE_URL` or raster templates at OSM Foundation (`tile.openstreetmap.org`) tile servers, whose usage policy prohibits bulk app traffic.
* For high-traffic municipal campaigns, generate or download a regional extract in **PMTiles** format, host the `.pmtiles` archive + MapLibre style JSON + glyphs/sprites on static object storage or Caddy/Nginx with HTTP `Range` request support + CORS headers, and set `OSM_STYLE_URL` to your self-hosted `style.json` (updatable via `.env` and container restart without rebuilding mobile binaries).

### Aerial Orthophotos (`EPSG:3857` XYZ or WMS) & Browser CORS

`ORTHOPHOTO_URL_TEMPLATE` accepts either `{z}/{x}/{y}` XYZ raster templates or OGC WMS `1.3.0` `EPSG:3857` templates containing `{bbox-epsg-3857}`:

```dotenv
ORTHOPHOTO_URL_TEMPLATE="https://map.example.org/ortho-wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=dop20&STYLES=&FORMAT=image/jpeg&TRANSPARENT=false&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}"
ORTHOPHOTO_TILE_SIZE=256
ORTHOPHOTO_ATTRIBUTION="© Municipal Geodata Agency (DL-DE->BY-2.0)"
ORTHOPHOTO_BOUNDS="9.70,53.35,10.35,53.75"
ORTHOPHOTO_MAX_ZOOM=20
```

* **Municipal WMS CORS Proxy:** Many municipal WMS servers omit `Access-Control-Allow-Origin` headers, causing WebGL canvas tile requests on Expo Web to fail. Proxy the upstream WMS under a same-origin path (e.g. `/ortho-wms` in Caddy/Nginx) or attach `Access-Control-Allow-Origin: https://map.example.org` at your reverse proxy.
* **Automatic Fallback:** If orthophoto tiles return errors or time out at runtime, `MapCanvas` automatically reverts the active basemap to `'osm'` and displays a dismissible warning banner.

---

## Environment Variable Reference (`.env`)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `POSTGRES_USER` | `ppgis` | PostgreSQL role used by `docker-compose.yml` and default `DATABASE_URL`. |
| `POSTGRES_PASSWORD` | `ppgis` | PostgreSQL password (**override with a strong secret in production**). |
| `POSTGRES_DB` | `ppgis` | PostgreSQL database name. |
| `HOST` | `0.0.0.0` | Fastify bind address inside the container. |
| `PORT` | `3000` | Fastify HTTP listen port (`0`–`65535`). |
| `DATABASE_URL` | `postgresql://ppgis:ppgis@127.0.0.1:5432/ppgis` | Full PostgreSQL connection URI (`@postgis:5432` inside Docker Compose). |
| `TRUST_PROXY` | `false` | Set `true` only when Fastify runs behind your trusted reverse proxy. |
| `CORS_ORIGIN` | `*` | Allowed browser CORS origin(s), comma-separated (e.g. `https://map.example.org`). |
| `OSM_STYLE_URL` | `https://tiles.openfreemap.org/styles/liberty` | MapLibre vector style JSON URL served via `GET /api/v1/config`. |
| `ORTHOPHOTO_URL_TEMPLATE` | *(empty — disabled)* | Optional `EPSG:3857` raster URL containing `{z}/{x}/{y}` or `{bbox-epsg-3857}`. |
| `ORTHOPHOTO_TILE_SIZE` | `256` | Raster orthophoto tile size (`256` or `512`). |
| `ORTHOPHOTO_ATTRIBUTION` | *(empty)* | Attribution string displayed when the orthophoto layer is active. |
| `ORTHOPHOTO_BOUNDS` | *(empty — unbounded)* | Optional `minLng,minLat,maxLng,maxLat` WGS 84 bounds restricting tile requests. |
| `ORTHOPHOTO_MAX_ZOOM` | `20` | Maximum zoom level fetched from the orthophoto source. |
| `INITIAL_LNG` | `9.9937` | Initial map camera longitude (WGS 84). |
| `INITIAL_LAT` | `53.5511` | Initial map camera latitude (WGS 84). |
| `INITIAL_ZOOM` | `15` | Initial map camera zoom level. |
| `MAX_DAILY_POLYGONS_PER_USER` | `25` | Rolling 24-hour polygon creation cap per user (tracked in `polygon_creations`; deleting a polygon does not refund quota). |
| `SESSION_TTL_DAYS` | `30` | Bearer session lifetime in days (`>= 1`, max `10` active sessions per user). |
| `DISCLAIMER_TEXT` | `Community unsealing suggestions — non-binding public input, regardless of property ownership.` | Civic notice shown on first visit and permanently inside `PolygonInspectorSheet`. |
| `ABUSE_CONTACT` | *(empty — `null`)* | Optional moderation email or URL shown inside `PolygonInspectorSheet`. |
| `EXPO_PUBLIC_API_BASE_URL` | `http://127.0.0.1:3000` | Base API URL baked into Expo mobile/web builds at bundle time. |

---

## Database Backups & Restore (`pg_dump` / `pg_restore`)

PostGIS topological validation runs in API write transactions rather than table `CHECK` constraints so logical dumps restore cleanly in any schema search-path order.

```bash
# Create a compressed custom-format backup
docker compose exec -T postgis pg_dump -U "${POSTGRES_USER:-ppgis}" -Fc "${POSTGRES_DB:-ppgis}" > backup-$(date +%Y%m%d).dump

# Restore into the running PostGIS container
docker compose exec -T postgis pg_restore -U "${POSTGRES_USER:-ppgis}" -d "${POSTGRES_DB:-ppgis}" --clean --if-exists < backup-YYYYMMDD.dump
```

---

## Operator Moderation CLI (`admin.ts`)

Operators can moderate abusive accounts, remove invalid proposals, or redact accidental personal data from proposal notes via `apps/api/src/cli/admin.ts`:

```bash
# 1. Ban an active or preemptive pseudonym (records SHA-256 tombstone, purges user's polygons & votes, and recomputes affected scores)
docker compose exec api node apps/api/dist/cli/admin.js ban-user <pseudonym> "spam brigading"

# 2. Delete a specific polygon proposal by UUID (cascades associated votes)
docker compose exec api node apps/api/dist/cli/admin.js delete-polygon <polygon-uuid>

# 3. Redact free-text note on a polygon while keeping the geometry and votes intact
docker compose exec api node apps/api/dist/cli/admin.js redact-note <polygon-uuid>
```

*(When running outside Docker against a local `DATABASE_URL`, execute `npm --workspace apps/api run build && npm --workspace apps/api run admin -- <command> ...`.)*

> **Why there is no `reset-recovery` CLI command:** Accounts store zero email or phone PII, and `authorPseudonym` is public on every proposal. An operator-initiated password or recovery reset would have no way to verify identity and would enable social-engineering account takeovers. Losing both password and recovery code permanently locks that pseudonym by design.

---

## Mobile Builds (Android, iOS `expo prebuild`, and Expo Web)

Because `@maplibre/maplibre-react-native`, `expo-location`, and `expo-secure-store` include native modules, Android and iOS builds use **Expo Prebuild** (`npx expo prebuild`) rather than the stock Expo Go client:

```bash
# Generate native android/ and ios/ directories from apps/mobile/app.json
cd apps/mobile
EXPO_PUBLIC_API_BASE_URL=https://map.example.org npx expo prebuild

# Build and launch on a connected Android device/emulator or iOS simulator
npm --workspace apps/mobile run android
npm --workspace apps/mobile run ios

# Export static production Web assets
EXPO_PUBLIC_API_BASE_URL=https://map.example.org npm --workspace apps/mobile run export:web
```

---

## Split Open-Source Licensing (`AGPL-3.0-or-later` & `MPL-2.0`)

Entsiegelungskartierung uses a split open-source license model to preserve strong server copyleft while maintaining full compatibility with mobile app store distribution terms:

* **Server & Repository Root (`AGPL-3.0-or-later`):** `apps/api` and root files (except workspaces providing their own `LICENSE`) are licensed under the **GNU Affero General Public License v3.0 or later** — see [`LICENSE`](./LICENSE) and [`apps/api/LICENSE`](./apps/api/LICENSE).
* **Mobile/Web Client & Shared Schemas (`MPL-2.0`):** `apps/mobile` and `packages/shared` are licensed under the **Mozilla Public License 2.0** — see [`apps/mobile/LICENSE`](./apps/mobile/LICENSE) and [`packages/shared/LICENSE`](./packages/shared/LICENSE) — avoiding Apple App Store DRM conflicts on client binaries.
* **AGPLv3 Section 13 Network-Interaction Clarification:** As stated in `LICENSE` and `apps/api/LICENSE`, client packages and applications licensed under `MPL-2.0` (including `packages/shared`, `apps/mobile`, and independent HTTP/GeoJSON clients) that communicate with the `apps/api` HTTP service over a computer network are separate works and remain covered by `MPL-2.0`. Communicating with the HTTP API over a network does not cause `MPL-2.0` client packages to become derivative or combined works under the GNU Affero General Public License.
