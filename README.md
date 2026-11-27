# <img src="apps/mobile/assets/openunseal-icon.svg" width="36" height="36" align="top" alt="OpenUnseal Icon" /> OpenUnseal - Open-Source Ground-Unsealing PPGIS

**OpenUnseal** (`open-unseal.de`) is an open-source Public Participation Geographic Information System (PPGIS) delivered as an installable **web app (PWA)** (German `de` default language with full English `en` switcher). Citizens map impervious ground surfaces ("ground sealing", such as asphalt parking corners, concrete courtyards, and paved street margins) proposed for unsealing, attach EXIF-sanitized site photos, and prioritize proposals through `+1` / `-1` community voting. New proposals state whether they lie on **public or private ground**; a chronological **Feed** lists new proposals and progress across Germany or around the current map view, and contributors who opt in can coordinate through pseudonymous **1:1 direct messages**.

Unauthenticated visitors can explore OpenStreetMap vector basemaps in light or dark mode (with automatic OS detection and a one-tap theme toggle), toggle built-in Germany-wide **DOP20 aerial orthophotos** (`EPSG:3857`) beneath proposal geometries, center on their position via the floating top-right **GNSS** button, inspect proposals and site photos, open the **`?` About** dialog, and export all proposals as RFC 7946 GeoJSON (`GET /api/v1/polygons/export.geojson`, `ODbL-1.0`) for direct analysis in QGIS or desktop GIS tools.

Contributors register pseudonymous accounts backed by **email link confirmation**, acceptance of the Privacy Policy and Terms of Use (`CC0 1.0` rights waiver on own polygon input/notes, `ODbL 1.0` on the compiled GeoJSON export, `CC BY 4.0` for photos/comments), and **VPS-hosted legal & password recovery pages** (`/auth/verify-email`, `/auth/reset-password`, `/auth/impressum`, `/auth/privacy`, `/auth/terms`, `/auth/licenses`). Email addresses are never exposed publicly - only the user's chosen `pseudonym` appears.

---

## Key Capabilities

* **2-Step Progressive Drawing Wizard & 4-Tab Inspector:**
  * *Creation:* Step 1 (`1. Umriss`) keeps >80% of the map visible while placing polygon vertices (`2-20,000 m²` interactive, up to `500,000 m²` for admin imports; topology & `< 2°` spike validation); Step 2 (`2. Details`) captures surface material (`Asphalt`, `Beton`, `Pflaster`, `Sonstige Versiegelung`), optional site notes, and optional camera/gallery photos.
  * *Inspection & Per-Polygon Threaded Discussion:* Sticky summary + `+1` / `-1` voting header above 4 segmented tabs (`Übersicht` | `Kommentare (N)` | `Fotos (N)` | `Verwaltung`) with nested replies, `+1` comment upvotes, and automatic top-rated comment pinning (`★ Top-Kommentar`).
* **Municipality-Bounded Score Coloring (Germany `BKG VG250`):**
  * Positive proposal scores (`score > 0`) scale along an emerald intensity gradient bounded to each German municipality's (`vg250_gem`) own positive score range (`municipalityNormalizedScore` in `[0, 1]`), so smaller municipalities are not drowned out by large cities. Statuses cover `proposed`, `in_progress` (`⟳ Wird entsiegelt`), and `finished` (`✓ Entsiegelt`).
* **EXIF-Stripped Site Photos, `"GPS verified"` Badge & `"Real"` / `"Fake"` Rating:**
  * Server-side processing checks EXIF GPS containment inside the polygon (`<= 3 m` tolerance buffer -> **`"GPS verified"`** badge, a plausibility signal since EXIF data can be edited) in memory *before* stripping 100% of EXIF/XMP/IPTC metadata and re-encoding to WebP (`sharp`). Community ratings (`"Echt"` / `"Real"` `+1`, `"Fake"` `-1`) automatically blur flagged photos (`credibilityScore <= -3`).
* **Public vs. Private Ground, "Help Wanted" & Land-Use Layer:**
  * Step 2 compares the drawn area with locally loaded land-use reference data (OpenStreetMap or `ALKIS` land use via `load-space-zones`, never ownership records; optional live Overpass lookup, off by default) and proposes `public` or `private`; the matched parts are marked on the map with their source credit. Deviations are flagged as `Nutzer-Override` until an admin decides. Authors of private areas can report progress themselves (with a photo and an entitlement confirmation), state that the area is open to the public, allow messages about it, or publish a time-limited call for help (`Hilfe gesucht`, ends after 90 days). Only the `spaceType` statement is part of the open dataset.
  * A toggleable **land-use layer** (`GET /api/v1/space-zones`, `ODbL-1.0` with credits) shows the reference data at street zoom. The map is confined to Germany by a bundled Natural Earth outline.
* **Feed (`Karte` | `Feed` | `Chat`):**
  * `GET /api/v1/polygons/feed` lists proposals of the last 180 days, newest activity first (creation, `Wird entsiegelt`, `Entsiegelt`). Feed cards are built from the same parts as the map's inspector (title, score and voting, note, contributor) with photos and the top comment laid open, and jump to the area's `Übersicht`, `Kommentare` or `Fotos` tab on the map. The feed can be narrowed to the map section (sent on a coarse `0.05°` grid, never the device position) or to one municipality, and shares its status and ground filters with the map.
* **Opt-In 1:1 Direct Messages:**
  * Off by default (GDPR Art. 25(2)). Until the person addressed answers, a conversation is a **request** limited to one message; withdrawing it deletes it. An account can try to reach at most 20 new people per day (only a date and a count are stored). Messages can reference areas and comments, are not end-to-end encrypted, expire after `CHAT_RETENTION_DAYS` (default 365), are erased with the sender's account, and can be blocked, deleted and reported (DSA Art. 16) by participants.
* **Admin Status Workflow & `.geojson` / `.gpkg` Bulk Import:**
  * `admin` accounts can transition polygon statuses, remove violating content (sending a DSA Art. 17 statement of reasons by email), and bulk-import `.geojson` or OGC GeoPackage (`.gpkg`, with CRS reprojection to `EPSG:4326`, `MultiPolygon` splitting, ODbL-1.0 compatibility checks, and persisted dataset attributions). Editing polygon metadata remains restricted strictly to the creating author.

---

## Architecture & Monorepo Layout

```mermaid
flowchart LR
  subgraph Client["apps/mobile (Expo Web / PWA - MPL-2.0)"]
    UI["2-Step Wizard, 4-Tab Inspector, Feed, Direct Messages, Pure Reducers"]
    MC["MapCanvas (MapLibre GL JS) + GNSS Button"]
    UI --> MC
  end
  subgraph Shared["packages/shared (Compiled ESM - MPL-2.0)"]
    ZOD["Canonical Zod Wire Schemas, Errors & Draft Validator"]
  end
  subgraph VPS["VPS Docker Stack (docker-compose.vps.yml)"]
    PROXY["Caddy 2 (Auto-HTTPS + Static Web)"]
    API["apps/api (Fastify /api/v1 + /auth/* HTML + /uploads/* - AGPL-3.0-or-later)"]
    DB[("PostgreSQL 16 + PostGIS 3.4 + BKG VG250 + Land-Use Zones")]
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
* **[`apps/mobile`](./apps/mobile) (`MPL-2.0`):** Expo SDK 52 web app, installable as a PWA (`de` default + `en` switcher).
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
* **Run build, typecheck & tests:** `npm run build && npm run typecheck && npm test` (the tests **empty every application table** of the database in `DATABASE_URL`; never point them at data you want to keep)
* **Run Web client:** `npm --workspace apps/mobile run web`

---

## Example Workflow (Participatory Mapping to Desktop GIS)

1. **Seed municipal boundaries & start the service:** With `AUTO_SEED_VG250=true` (enabled by default in `docker-compose.yml`), OpenUnseal loads German `BKG VG250` municipality boundaries so positive vote scores normalize within each municipality (`[0, 1]`).
2. **Map or import candidate depaving sites:**
   * *Interactive mapping:* Open the Web or mobile client, toggle `DOP20` aerial orthophotos beneath the map, trace an impervious surface (`2-20,000 m²`), select its material (`Asphalt`, `Beton`, `Pflaster`, `Sonstige Versiegelung`), and optionally attach an on-site camera photo (checked in memory against a `3 m` polygon buffer before 100% EXIF stripping).
   * *Field-survey bulk import (`admin`):* Upload existing `.gpkg` (e.g. `QField` surveys) or `.geojson` inventories via the admin-only import entry in the map menu. Imports are reprojected to `EPSG:4326` and checked for polygon type, validity, vertex count, extent and area only; overlap, land-cover and shape checks do not run, so the importing admin is responsible for the content.
3. **Prioritize & stream open `ODbL-1.0` GeoJSON into QGIS:**
   ```bash
   curl -fsS http://127.0.0.1:3000/api/v1/polygons/export.geojson -o openunseal-proposals.geojson
   ```
   Load `openunseal-proposals.geojson` (or connect QGIS directly via *Data Source Manager -> Vector -> Protocol: HTTP(S), cloud -> GeoJSON*) to overlay community-ranked depaving polygons (`score`, `municipalityNormalizedScore`, `areaM2`, `surfaceType`, `origin`, `wasAutoClipped`) against municipal heat, stormwater runoff, or `ALKIS` parcel layers.

---

## Documentation

* **[`docs/installation.md`](./docs/installation.md)** - Full local setup, testing, the production web build, operator `admin.ts` CLI, and environment variable reference.
* **[`docs/vps-setup.md`](./docs/vps-setup.md)** - Turnkey Linux VPS deployment (`docker-compose.vps.yml`, Caddy auto-HTTPS, DNS, SMTP, admin account promotion, and backups).

---

## Community, Contributing & Citation

* **Contributing, reporting bugs & seeking support:** See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and open bug reports, feature requests, or support questions in [GitHub Issues](https://github.com/severinbro/Unseal/issues).
* **Code of Conduct:** Participation in this project is governed by our [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md).
* **Citing OpenUnseal:** Machine-readable citation metadata is provided in [`CITATION.cff`](./CITATION.cff).
* **Name & Affiliation Note:** OpenUnseal (`open-unseal.de`) is an independent open-source software project and is not affiliated with the European Driving Urban Transitions (DUT) *UNSEAL* research consortium (`unseal.eu`) or unrelated commercial applications named "Unseal".

---

## Split Open-Source Licensing (`AGPL-3.0-or-later` & `MPL-2.0`)

* **Server & Repository Root (`AGPL-3.0-or-later`):** `apps/api` and root files (except workspaces providing their own `LICENSE`) are licensed under the **GNU Affero General Public License v3.0 or later** - see [`LICENSE`](./LICENSE).
* **Mobile/Web Client & Shared Schemas (`MPL-2.0`):** `apps/mobile` and `packages/shared` are licensed under the **Mozilla Public License 2.0** - see [`apps/mobile/LICENSE`](./apps/mobile/LICENSE) and [`packages/shared/LICENSE`](./packages/shared/LICENSE).
* **Split-License Scope, AGPLv3 §13 Clarification & Third-Party Notices:** See [`LICENSING.md`](./LICENSING.md) (including the AGPLv3 Section 13 network-interaction clarification that `MPL-2.0` HTTP/GeoJSON clients remain separate works under `MPL-2.0`) and [`THIRD_PARTY_NOTICES.txt`](./THIRD_PARTY_NOTICES.txt) for third-party software, Docker stack, and geodata licenses.
