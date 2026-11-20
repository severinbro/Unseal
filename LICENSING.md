# OpenUnseal (`Entsiegelungskartierung`) – Licensing Notice

Copyright (C) 2026 OpenUnseal Contributors

OpenUnseal uses a **split open-source licensing model** across its monorepo workspaces to preserve strong network copyleft on the backend service while keeping the cross-platform client and shared wire contracts compatible with mobile app-store distribution policies.

The canonical, unmodified license texts live in their respective `LICENSE` files; this notice defines the scope of each license and provides third-party and data-license references.

---

## 1. Software Licenses by Component

| Path | License (SPDX) | Verbatim License Text |
| :--- | :--- | :--- |
| Repository root, `apps/api`, `scripts/`, `test/`, Docker & deployment files | `AGPL-3.0-or-later` | [`LICENSE`](./LICENSE) |
| `packages/shared` (`@openunseal/shared`) | `MPL-2.0` | [`packages/shared/LICENSE`](./packages/shared/LICENSE) |
| `apps/mobile` (`@openunseal/mobile`) | `MPL-2.0` | [`apps/mobile/LICENSE`](./apps/mobile/LICENSE) |

* **Server & Repository Components (`AGPL-3.0-or-later`):** Except where a workspace directory provides its own `LICENSE` file, this repository (including `apps/api`) is free software licensed under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version (`AGPL-3.0-or-later`).
* **Client & Shared Contract Packages (`MPL-2.0`):** `packages/shared` and `apps/mobile` are licensed separately under the Mozilla Public License Version 2.0 (`MPL-2.0`), without attaching the Exhibit B "Incompatible With Secondary Licenses" notice to their Source Code Form. Under MPL-2.0 Section 3.3, `apps/api` may combine `@openunseal/shared` into an `AGPL-3.0-or-later` work while `@openunseal/shared` itself remains available under `MPL-2.0`.

---

## 2. AGPLv3 Section 13 Network-Interaction Clarification

For the avoidance of doubt regarding Section 13 of the GNU Affero General Public License, client packages and applications licensed under `MPL-2.0` (including `packages/shared` and `apps/mobile`, as well as independent HTTP or GeoJSON API clients) that communicate with the `apps/api` HTTP service over a computer network are separate works and remain covered by `MPL-2.0` (or their respective licenses). Communicating with the HTTP API over a network does not cause `MPL-2.0` client packages to become derivative or combined works under the GNU Affero General Public License.

Operators running a modified version of `apps/api` that interacts with users over a network must prominently offer Corresponding Source under AGPLv3 Section 13 (configured via `SOURCE_CODE_URL`, surfaced on `/auth/impressum`, `/auth/licenses`, `/api/v1/config`, and the client's About dialog).

---

## 3. Third-Party Software & Runtime Stack Notices

Complete third-party npm dependency licenses, copyright notices, full permissive license texts for bundled libraries, native mobile SDK licenses (including MapLibre Native Android/iOS under `BSD-2-Clause`, MapLibre Android plugins under `Apache-2.0`/`BSD-2-Clause`, `Android-Image-Cropper` under `Apache-2.0`, `SmartLocation` under `MIT`, `Google Play Services Location` under Google APIs Terms of Service compatible with `MPL-2.0` § 3.3, and MapLibre React Native under `MIT`), `@img/sharp-libvips` bundled C libraries (`LGPL-3.0-or-later`), and Docker runtime stack components (`Node.js`, `PostgreSQL`, `PostGIS`, `Caddy`, `Mailpit`) are documented in [`THIRD_PARTY_NOTICES.txt`](./THIRD_PARTY_NOTICES.txt) (regenerated via `npm run licenses:generate`, served at `/auth/third-party-notices`, and embedded into native Android/iOS builds via `apps/mobile/plugins/withBundledLicenses.cjs`).

> Note on prebuilt Docker images: Source distribution on GitHub and network operation of `apps/api` do not distribute compiled `@img/sharp-libvips` binaries directly. If prebuilt Docker images containing `libvips` (`LGPL-3.0-or-later`) are ever publicly distributed, include the verbatim `LGPL-3.0` and `GPL-3.0` texts and corresponding source / relinking instructions per LGPLv3 § 4.

---

## 4. User-Contributed Content & Geodata Licenses

* **Compiled polygon dataset export & contributor rights waiver (`ODbL-1.0` + `CC0-1.0`):**
  * Contributors waive their own copyright and database rights in submitted polygon geometries, surface classifications, and site notes via [Creative Commons Zero 1.0 Universal (`CC0-1.0`)](https://creativecommons.org/publicdomain/zero/1.0/) (including its Section 3 Public License Fallback where statutory waiver is unavailable, e.g. § 29 German UrhG) to the extent not derived from third-party basemaps.
  * Because proposals are traced and enriched against OpenStreetMap (`ODbL-1.0`), German state aerial orthophotos (`dl-de/by-2-0`, `CC BY 4.0`, `dl-de/zero-2-0`), and BKG municipality boundaries (`VG250`, `dl-de/by-2-0`), the compiled public GeoJSON dataset (`GET /api/v1/polygons/export.geojson`) is licensed under the [Open Data Commons Open Database License 1.0 (`ODbL-1.0`)](https://opendatacommons.org/licenses/odbl/1-0/) with full upstream attributions.
  * Admin bulk imports (`.geojson` / `.gpkg`) enter the same `ODbL-1.0` export and must come strictly from directly `ODbL-1.0`-compatible open sources (`CC0-1.0`, `PDDL-1.0`, `dl-de/zero-2-0`, `Public Domain`, or `ODbL-1.0` with mandatory persisted `attribution`), or from `CC BY 4.0` / `dl-de/by-2-0` datasets **only** when a documented explicit ODbL-1.0 compatibility waiver is confirmed (`waiverConfirmed=true`) together with persisted upstream attribution (per OSMF LWG guidance on `CC BY 4.0` / `dl-de/by-2-0` vs `ODbL-1.0`). Active import attributions are persisted in `import_attributions` and emitted inside `/api/v1/polygons/export.geojson`. Incompatible restrictive licenses (`NC`, `ND`, `SA`, proprietary) are rejected both via query parameters and embedded GeoJSON / GeoPackage `gpkg_metadata`.
* **User-uploaded site photos and comments:** Licensed under [Creative Commons Attribution 4.0 International (`CC BY 4.0`)](https://creativecommons.org/licenses/by/4.0/) with attribution to the contributor's public pseudonym (or anonymized as `deleted` upon user-initiated account deletion without content purge). Photos are modified on upload (EXIF/XMP/IPTC stripped and re-encoded/resized to WebP). While users may delete contributions from the platform at any time, open-data licenses on copies legitimately downloaded prior to deletion remain irrevocable under their respective license terms.
* **Default external geodata & map sources:**
  * Basemap tiles, styles, relief & fonts: **OpenFreeMap** (`MIT`; operated by Hyperknot Software Kft.), **© OpenMapTiles** & **© CARTO** (modified in dark mode) / **OSM Liberty** (`CC BY 4.0` / `BSD-3-Clause` / `MIT`), **© OpenStreetMap contributors** (`ODbL-1.0`), **Natural Earth** (`Public Domain`), **Noto Sans** (`SIL OFL 1.1`).
  * Address geocoding: **OpenStreetMap Nominatim** (`© OpenStreetMap contributors`, `ODbL-1.0`).
  * German municipality boundaries (`VG250`): **© GeoBasis-DE / BKG** (`(<year of data retrieval>)`), [Datenlizenz Deutschland – Namensnennung 2.0 (`dl-de/by-2-0`)](https://www.govdata.de/dl-de/by-2-0), [Datenquellen](https://sg.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf) (*Daten verändert*).
  * Built-in German state aerial orthophotos (`DOP20` / `DOP10`): Provided by the 16 German state survey offices under their respective Open Data licenses (`dl-de/by-2-0`, `CC BY 4.0`, and `dl-de/zero-2-0`; *Daten bearbeitet* / *Daten verändert* at cross-state tile composites; Hamburg `wms_dop_zeitreihe_unbelaubt` pinned to `TIME=2026` LGV `dl-de/by-2-0` aerials). Exact live-verified per-state agency credits and license links are defined in `packages/shared/src/dop20Providers.ts`, displayed dynamically by viewport on both Web and Native maps, and listed in [`THIRD_PARTY_NOTICES.txt`](./THIRD_PARTY_NOTICES.txt) and `/auth/licenses`.
