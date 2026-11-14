# <img src="apps/mobile/assets/unseal-icon.svg" width="36" height="36" align="top" alt="Unseal Icon" /> Unseal - Open-Source Ground-Unsealing PPGIS

**Unseal** is an open-source Public Participation Geographic Information System (PPGIS) for **Android, iOS, and Web** (German `de` default language with full English `en` switcher). Citizens map impervious ground surfaces ("ground sealing", such as asphalt parking corners, concrete courtyards, and paved street margins) proposed for unsealing, attach EXIF-sanitized site photos, and prioritize proposals through `+1` / `-1` community voting.

Unauthenticated visitors can explore OpenStreetMap vector basemaps, toggle built-in Germany-wide **DOP20 aerial orthophotos** (`EPSG:3857`) beneath proposal geometries, center on their position via the floating top-right **GNSS** button, inspect proposals and site photos, open the **`?` About** dialog, download the standalone Android `.apk`, and export all proposals as RFC 7946 GeoJSON (`GET /api/v1/polygons/export.geojson`) for direct analysis in QGIS or desktop GIS tools.

Contributors register pseudonymous accounts backed by **email link confirmation** and **VPS-hosted password recovery pages** (`/auth/verify-email`, `/auth/reset-password`, `/auth/privacy`). Email addresses are used strictly for account verification and password recovery and are **never exposed publicly** on the map, on photos, or in GeoJSON exports - only the user's chosen `pseudonym` appears.

---

## Key Capabilities

* **2-Step Progressive Drawing Wizard & 4-Tab Inspector:**
  * *Creation:* Step 1 (`1. Umriss`) keeps >80% of the map visible while placing polygon vertices (`2–500,000 m²`, topology & `< 2°` spike validation); Step 2 (`2. Details`) captures surface material (`Asphalt`, `Beton`, `Pflaster`, `Sonstige Versiegelung`), optional site notes, and optional camera/gallery photos.
  * *Inspection & Per-Polygon Threaded Discussion:* Sticky summary + `+1` / `-1` voting header above 4 segmented tabs (`Übersicht` | `Kommentare (N)` | `Fotos (N)` | `Verwaltung`). Every polygon has its own isolated comment thread supporting nested replies, `+1` comment upvotes, and automatic top-rated comment pinning (`★ Top-Kommentar`).
* **Municipality-Bounded Score Coloring (Germany `BKG VG250`):**
  * Positive proposal scores (`score > 0`) scale along an emerald intensity gradient **bounded to each German municipality's (`vg250_gem`) own positive score range** (`municipalityNormalizedScore` in `[0, 1]`), so smaller municipalities are never drowned out by large cities like Hamburg or Berlin. Neutral (`0`) stays ochre, negative (`< 0`) terracotta, sites currently being depaved (`in_progress`) render in civic blue (`⟳ Wird entsiegelt`), and completed unsealing projects (`finished`) render in teal (`✓ Entsiegelt`).
* **EXIF-Stripped Site Photos, `"GPS verified"` Badge & `"Real"` / `"Fake"` Rating:**
  * Authenticated users can shoot or upload photos during creation or on existing polygons. Server-side processing checks EXIF GPS containment inside the polygon (`<= 3 m` tolerance buffer -> **`"GPS verified"`** badge) in memory *before* stripping 100% of EXIF/XMP/IPTC metadata and re-encoding to WebP (`sharp`). Community members can rate photos as `"Echt"` / `"Real"` (`+1`) or `"Fake"` (`-1`), automatically blurring photos flagged by consensus (`credibilityScore <= -3`).
* **Admin Status Workflow & `.geojson` / `.gpkg` Bulk Import:**
  * Only `admin` accounts can set polygon statuses (`proposed`, `in_progress` / `Wird entsiegelt`, `finished` / `✓ Entsiegelt`) or bulk-import `.geojson` and OGC GeoPackage (`.gpkg`, including automatic CRS reprojection to `EPSG:4326` and `MultiPolygon` splitting). Polygon deletion remains restricted strictly to the creating author (or CLI moderation).

---

## Architecture & Monorepo Layout

```mermaid
flowchart LR
  subgraph Client["apps/mobile (Expo Android / iOS / Web - MPL-2.0)"]
    UI["2-Step Wizard, 3-Tab Inspector, Pure Reducers"]
    MC["MapCanvas (.native.tsx / .web.tsx) + GNSS Button"]
    UI --> MC
  end
  subgraph Shared["packages/shared (Compiled ESM - MPL-2.0)"]
    ZOD["Canonical Zod Wire Schemas, Errors & Draft Validator"]
  end
  subgraph VPS["VPS Docker Stack (docker-compose.vps.yml)"]
    PROXY["Caddy 2 (Auto-HTTPS + Static Web)"]
    API["apps/api (Fastify /api/v1 + /auth/* HTML + /uploads/* - AGPL-3.0-or-later)"]
    DB[("PostgreSQL 16 + PostGIS 3.4 + BKG VG250")]
    VOL[("uploads_data (EXIF-Stripped WebP)")]
    PROXY --> API
    API --> DB
    API --> VOL
  end
  SMTP["Outbound SMTP Account"]
  Tiles["Configurable OSM Vector Style & EPSG:3857 Orthophoto Tiles"]
  UI -. imports .-> ZOD
  API -. imports .-> ZOD
  UI <-->|"HTTPS JSON / Multipart + Bearer Session"| PROXY
  API -->|"Verification & Reset Links"| SMTP
  MC -->|"HTTPS Tile GET"| Tiles
```

* **`packages/shared` (`MPL-2.0`):** Compiled ESM package (`dist/`) exporting `camelCase` Zod request/response schemas, `ErrorCode` + `ApiError`, and client-side single-ring polygon pre-checks (`@turf/area`, `@turf/kinks`, consecutive duplicate tap deduplication, and `< 2°` fold-back spike detection).
* **`apps/api` (`AGPL-3.0-or-later`):** Single-replica compiled Fastify service backed by PostgreSQL 16 + PostGIS 3.4, serving `/api/v1/*`, hosted HTML email confirmation & password recovery pages (`/auth/*`), EXIF-stripped WebP photos (`/uploads/*`), BKG VG250 municipality loader, `.geojson`/`.gpkg` importer, Argon2id password hashing gated by a bounded semaphore, IPv6 `/64`-normalized rate limiting, Pino structured logging with omitted client IPs, and the `admin.ts` CLI.
* **`apps/mobile` (`MPL-2.0`):** Expo SDK 52 application targeting Android, iOS, and Web, localized in German (`de`, default) and English (`en`) with an inline `DE | EN` language switcher (`src/i18n/translations.ts`).
* **`test/e2e-flow.test.ts`:** Root full-stack integration suite exercising `PpgisApiClient`, `appReducer`, hosted `/auth/*` email verification & password reset pages, EXIF GPS photo stripping, VG250 municipality normalization, and admin import/status workflows over live HTTP against Fastify + PostGIS.

---

## 1. Local Development & Testing Setup

### Prerequisites

* **Node.js `>= 24.0.0`** and `npm`
* **Docker Engine** with **Docker Compose v2**

### Step 1: Clone & Install Dependencies

```bash
git clone https://github.com/severinbro/Unseal.git
cd Unseal
npm ci
```

### Step 2: Start the Local Backend Stack (`postgis` + `mailpit` + `api`)

```bash
cp .env.example .env
docker compose up -d --build
```

* **API & Hosted Auth Pages:** `http://127.0.0.1:3000` (`/api/v1/health`, `/api/v1/config`, `/auth/privacy`)
* **Local Mailpit Email Inbox:** `http://127.0.0.1:8025` (captures all local registration confirmation and password recovery emails with clickable links)
* **BKG VG250 Municipalities:** Automatically downloaded and seeded (~11,000 German municipalities) on first startup when `AUTO_SEED_VG250=true`.

```bash
curl -fsS http://127.0.0.1:3000/api/v1/health
curl -fsS http://127.0.0.1:3000/api/v1/config
```

### Step 3: Build, Typecheck, and Run the Automated Test Suite

```bash
npm run build
npm run typecheck
npm test
```

### Step 4: Run the Web App or Test on an Android Smartphone via USB (`adb`)

* **Web App:**
  ```bash
  npm --workspace apps/mobile run web
  ```
* **Android Smartphone over USB Debugging (`adb`):**
  Forward port `3000` from your phone to your local Docker API and build/install the standalone APK:
  ```bash
  adb reverse tcp:3000 tcp:3000
  cd apps/mobile
  npx expo prebuild --platform android
  ./android/gradlew -p android assembleRelease
  adb install -r android/app/build/outputs/apk/release/app-release.apk
  ```

---

## 2. Production VPS Deployment (`docker-compose.vps.yml`)

A complete turnkey VPS deployment stack is included in the repository:

* [`docker-compose.vps.yml`](./docker-compose.vps.yml) - Air-gapped `postgis` (`db_internal` network, zero host ports exposed), `api` (`uploads_data` volume + hosted `/auth/*` confirmation/recovery pages + SMTP), and `caddy` (automatic Let's Encrypt HTTPS on `80`/`443` + zero client IP access logs).
* [`Caddyfile.vps`](./Caddyfile.vps) - Reverse-proxies `/api/*`, `/auth/*`, `/uploads/*`, and `/downloads/*` to `api:3000` and serves static Expo Web assets from `./dist-web`.
* [`.env.vps.example`](./.env.vps.example) - Production environment template (`DOMAIN`, `POSTGRES_PASSWORD`, `SMTP_*`, `AUTO_SEED_VG250`, etc.).
* **[`docs/vps-setup.md`](./docs/vps-setup.md) - Step-by-step VPS installation, DNS/TLS, SMTP, Admin account promotion, and backup guide.**

Quick launch on your Linux VPS:

```bash
git clone https://github.com/severinbro/Unseal.git /opt/unseal
cd /opt/unseal

cp .env.vps.example .env.vps
chmod 600 .env.vps
# Edit .env.vps with your DOMAIN, POSTGRES_PASSWORD, and SMTP_* credentials

mkdir -p dist-web
docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
```

---

## 3. Operator Moderation & Administration CLI (`admin.ts`)

```bash
# 1. Grant or revoke administrator privileges (enables "finished" status & .geojson/.gpkg import)
docker compose exec api node apps/api/dist/cli/admin.js grant-admin <pseudonym>
docker compose exec api node apps/api/dist/cli/admin.js revoke-admin <pseudonym>

# 2. Seed or refresh German BKG VG250 municipality boundaries (from live BKG WFS or local .geojson)
docker compose exec api node apps/api/dist/cli/admin.js load-vg250

# 3. Ban an abusive pseudonym (records SHA-256 tombstones, purges user's polygons/photos/votes, recomputes scores)
docker compose exec api node apps/api/dist/cli/admin.js ban-user <pseudonym> "spam brigading"

# 4. Delete a specific polygon proposal or comment by UUID, or redact a proposal's free-text note
docker compose exec api node apps/api/dist/cli/admin.js delete-polygon <polygon-uuid>
docker compose exec api node apps/api/dist/cli/admin.js delete-comment <comment-uuid>
docker compose exec api node apps/api/dist/cli/admin.js redact-note <polygon-uuid>
```

*(On your production VPS, add `--env-file .env.vps -f docker-compose.vps.yml` right after `docker compose`.)*

---

## 4. Production Mobile & Web Builds

Because `@maplibre/maplibre-react-native`, `expo-location`, `expo-image-picker`, `expo-document-picker`, and `expo-secure-store` include native modules, Android and iOS builds use **Expo Prebuild** (`npx expo prebuild`):

```bash
# Export static production Web assets into ./dist-web
EXPO_PUBLIC_API_BASE_URL=https://unseal.example.org npm --workspace apps/mobile run export:web

# Prebuild & compile native Android / iOS apps pointing at your production VPS
cd apps/mobile
EXPO_PUBLIC_API_BASE_URL=https://unseal.example.org npx expo prebuild
npm --workspace apps/mobile run android
npm --workspace apps/mobile run ios
```

---

## 5. Environment Variable Reference

| Variable | Default | Description |
| :--- | :--- | :--- |
| `POSTGRES_USER` | `ppgis` | PostgreSQL role. |
| `POSTGRES_PASSWORD` | `ppgis` | PostgreSQL password (**override with a strong secret in production**). |
| `POSTGRES_DB` | `ppgis` | PostgreSQL database name. |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Fastify bind address and HTTP port inside container. |
| `DATABASE_URL` | `postgresql://ppgis:ppgis@127.0.0.1:5432/ppgis` | Full PostgreSQL connection URI (`@postgis:5432` inside Docker). |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:3000` | Public origin embedded in registration & password reset email links (e.g. `https://unseal.example.org`). |
| `UPLOADS_DIR` | `./uploads` | Directory storing EXIF-stripped WebP polygon photos (`/var/lib/entsiegelung/uploads` in Docker). |
| `AUTO_SEED_VG250` | `false` (`true` in Compose) | Automatically download & seed German BKG VG250 OpenData municipalities when empty. |
| `SMTP_HOST` / `SMTP_PORT` | *(empty)* / `587` | Outbound SMTP hostname and port (`mailpit` / `1025` in local `docker-compose.yml`). |
| `SMTP_SECURE` | `false` (`true` if `465`) | Use implicit TLS (`true` for port `465`, `false` for STARTTLS on `587`). |
| `SMTP_USER` / `SMTP_PASS` | *(empty)* | SMTP authentication credentials. |
| `SMTP_FROM` | `Unseal <noreply@localhost>` | Sender `From:` header for confirmation and password reset emails. |
| `TRUST_PROXY` | `false` | Set `true` behind Caddy/Nginx/Traefik. |
| `CORS_ORIGIN` | `*` | Allowed browser CORS origin(s), comma-separated. |
| `OSM_STYLE_URL` | `https://tiles.openfreemap.org/styles/liberty` | MapLibre vector style JSON URL. |
| `ORTHOPHOTO_*` | *(built-in Germany DOP20)* | Built-in server-proxied German DOP20 aerial orthophotos (`/api/v1/tiles/dop20/{z}/{x}/{y}.png`); set `ORTHOPHOTO_URL_TEMPLATE=none` to disable or override with a custom `EPSG:3857` URL. |
| `APK_DOWNLOAD_URL` / `APK_FILE_PATH` | `/downloads/unseal.apk` / `<UPLOADS_DIR>/unseal.apk` | Optional direct Android `.apk` download link (`none` to hide button) and server file location. |
| `INITIAL_LNG` / `LAT` / `ZOOM` | `8.2739` / `49.9989` / `15` | Default initial viewport camera (Mainz Cathedral). |
| `MAX_DAILY_POLYGONS_PER_USER` | `25` | Rolling 24-hour polygon creation cap per user. |
| `SESSION_TTL_DAYS` | `30` | Bearer session lifetime in days. |
| `DISCLAIMER_TEXT` / `ABUSE_CONTACT` | *(civic notice)* / *(empty)* | Public notice and optional moderation contact shown in inspector & privacy page. |
| `EXPO_PUBLIC_API_BASE_URL` | `http://127.0.0.1:3000` | Base API URL baked into Expo mobile/web builds at bundle time. |

---

## 6. Split Open-Source Licensing (`AGPL-3.0-or-later` & `MPL-2.0`)

* **Server & Repository Root (`AGPL-3.0-or-later`):** `apps/api` and root files (except workspaces providing their own `LICENSE`) are licensed under the **GNU Affero General Public License v3.0 or later** - see [`LICENSE`](./LICENSE) and [`apps/api/LICENSE`](./apps/api/LICENSE).
* **Mobile/Web Client & Shared Schemas (`MPL-2.0`):** `apps/mobile` and `packages/shared` are licensed under the **Mozilla Public License 2.0** - see [`apps/mobile/LICENSE`](./apps/mobile/LICENSE) and [`packages/shared/LICENSE`](./packages/shared/LICENSE).
* **AGPLv3 Section 13 Network-Interaction Clarification:** Client packages and applications licensed under `MPL-2.0` (including `packages/shared`, `apps/mobile`, and independent HTTP/GeoJSON clients) that communicate with the `apps/api` HTTP service over a computer network are separate works and remain covered by `MPL-2.0`.
