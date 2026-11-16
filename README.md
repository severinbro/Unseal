# <img src="apps/mobile/assets/unseal-icon.svg" width="36" height="36" align="top" alt="Unseal Icon" /> Unseal - Open-Source Ground-Unsealing PPGIS

**Unseal** is an open-source Public Participation Geographic Information System (PPGIS) for **Android, iOS, and Web** (German `de` default language with full English `en` switcher). Citizens map impervious ground surfaces ("ground sealing", such as asphalt parking corners, concrete courtyards, and paved street margins) proposed for unsealing, attach EXIF-sanitized site photos, and prioritize proposals through `+1` / `-1` community voting.

Unauthenticated visitors can explore OpenStreetMap vector basemaps in light or dark mode (with automatic OS detection and a one-tap theme toggle), toggle built-in Germany-wide **DOP20 aerial orthophotos** (`EPSG:3857`) beneath proposal geometries, center on their position via the floating top-right **GNSS** button, inspect proposals and site photos, open the **`?` About** dialog, download the standalone Android `.apk` (when hosted on the server), and export all proposals as RFC 7946 GeoJSON (`GET /api/v1/polygons/export.geojson`, `CC0-1.0`) for direct analysis in QGIS or desktop GIS tools.

Contributors register pseudonymous accounts backed by **email link confirmation**, acceptance of the Privacy Policy and Terms of Use (`CC0 1.0` for polygon geometries/notes, `CC BY 4.0` for photos/comments), and **VPS-hosted legal & password recovery pages** (`/auth/verify-email`, `/auth/reset-password`, `/auth/impressum`, `/auth/privacy`, `/auth/terms`, `/auth/licenses`). Email addresses are never exposed publicly — only the user's chosen `pseudonym` appears.

---

## Key Capabilities

* **2-Step Progressive Drawing Wizard & 4-Tab Inspector:**
  * *Creation:* Step 1 (`1. Umriss`) keeps >80% of the map visible while placing polygon vertices (`2–500,000 m²`, topology & `< 2°` spike validation); Step 2 (`2. Details`) captures surface material (`Asphalt`, `Beton`, `Pflaster`, `Sonstige Versiegelung`), optional site notes, and optional camera/gallery photos.
  * *Inspection & Per-Polygon Threaded Discussion:* Sticky summary + `+1` / `-1` voting header above 4 segmented tabs (`Übersicht` | `Kommentare (N)` | `Fotos (N)` | `Verwaltung`) with nested replies, `+1` comment upvotes, and automatic top-rated comment pinning (`★ Top-Kommentar`).
* **Municipality-Bounded Score Coloring (Germany `BKG VG250`):**
  * Positive proposal scores (`score > 0`) scale along an emerald intensity gradient bounded to each German municipality's (`vg250_gem`) own positive score range (`municipalityNormalizedScore` in `[0, 1]`), so smaller municipalities are not drowned out by large cities. Statuses cover `proposed`, `in_progress` (`⟳ Wird entsiegelt`), and `finished` (`✓ Entsiegelt`).
* **EXIF-Stripped Site Photos, `"GPS verified"` Badge & `"Real"` / `"Fake"` Rating:**
  * Server-side processing checks EXIF GPS containment inside the polygon (`<= 3 m` tolerance buffer -> **`"GPS verified"`** badge) in memory *before* stripping 100% of EXIF/XMP/IPTC metadata and re-encoding to WebP (`sharp`). Community ratings (`"Echt"` / `"Real"` `+1`, `"Fake"` `-1`) automatically blur flagged photos (`credibilityScore <= -3`).
* **Admin Status Workflow & `.geojson` / `.gpkg` Bulk Import:**
  * `admin` accounts can transition polygon statuses and bulk-import `.geojson` or OGC GeoPackage (`.gpkg`, with CRS reprojection to `EPSG:4326` and `MultiPolygon` splitting). Polygon deletion remains restricted strictly to the creating author (or CLI moderation).

---

## Architecture & Monorepo Layout

```mermaid
flowchart LR
  subgraph Client["apps/mobile (Expo Android / iOS / Web - MPL-2.0)"]
    UI["2-Step Wizard, 4-Tab Inspector, Pure Reducers"]
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

* **[`packages/shared`](./packages/shared) (`MPL-2.0`):** Compiled ESM package exporting `camelCase` Zod request/response schemas, `ErrorCode` + `ApiError`, and client-side single-ring polygon validation.
* **[`apps/api`](./apps/api) (`AGPL-3.0-or-later`):** Fastify service backed by PostgreSQL 16 + PostGIS 3.4, serving `/api/v1/*`, `/auth/*` HTML pages, EXIF-stripped WebP `/uploads/*`, BKG VG250 municipality loader, `.geojson`/`.gpkg` importer, and the `admin.ts` moderation CLI.
* **[`apps/mobile`](./apps/mobile) (`MPL-2.0`):** Expo SDK 52 application targeting Android, iOS, and Web (`de` default + `en` switcher).
* **[`test/e2e-flow.test.ts`](./test/e2e-flow.test.ts):** Root full-stack integration suite exercising client, reducer, `/auth/*` pages, EXIF stripping, VG250 normalization, and admin workflows against live Fastify + PostGIS.

---

## Quick Start (Local Development)

Requires **Node.js `>= 24.0.0`** and **Docker Engine / Compose v2**:

```bash
git clone https://github.com/severinbro/Unseal.git
cd Unseal
npm ci
cp .env.example .env
docker compose up -d --build
```

* **API & Hosted Auth / Legal Pages:** `http://127.0.0.1:3000`
* **Mailpit Local Inbox:** `http://127.0.0.1:8025`
* **Run build, typecheck & tests:** `npm run build && npm run typecheck && npm test`
* **Run Web client:** `npm --workspace apps/mobile run web`

---

## Documentation

* **[`docs/installation.md`](./docs/installation.md)** — Full local setup, testing, Web/Android/iOS builds, **Android release APK signing & manifest hardening**, operator `admin.ts` CLI, and environment variable reference.
* **[`docs/vps-setup.md`](./docs/vps-setup.md)** — Turnkey Linux VPS deployment (`docker-compose.vps.yml`, Caddy auto-HTTPS, DNS, SMTP, admin account promotion, and backups).

---

## Split Open-Source Licensing (`AGPL-3.0-or-later` & `MPL-2.0`)

* **Server & Repository Root (`AGPL-3.0-or-later`):** `apps/api` and root files (except workspaces providing their own `LICENSE`) are licensed under the **GNU Affero General Public License v3.0 or later** — see [`LICENSE`](./LICENSE) and [`apps/api/LICENSE`](./apps/api/LICENSE).
* **Mobile/Web Client & Shared Schemas (`MPL-2.0`):** `apps/mobile` and `packages/shared` are licensed under the **Mozilla Public License 2.0** — see [`apps/mobile/LICENSE`](./apps/mobile/LICENSE) and [`packages/shared/LICENSE`](./packages/shared/LICENSE).
* **AGPLv3 Section 13 Network-Interaction Clarification:** Client packages and applications licensed under `MPL-2.0` (including `packages/shared`, `apps/mobile`, and independent HTTP/GeoJSON clients) that communicate with the `apps/api` HTTP service over a computer network are separate works and remain covered by `MPL-2.0`.
