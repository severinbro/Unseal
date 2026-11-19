# Unseal (`Entsiegelungskartierung`) – Licensing Notice

Copyright (C) 2026 Unseal Contributors

Unseal uses a **split open-source licensing model** across its monorepo workspaces to preserve strong network copyleft on the backend service while keeping the cross-platform client and shared wire contracts compatible with mobile app-store distribution policies.

The canonical, unmodified license texts live in their respective `LICENSE` files; this notice defines the scope of each license and provides third-party and data-license references.

---

## 1. Software Licenses by Component

| Path | License (SPDX) | Verbatim License Text |
| :--- | :--- | :--- |
| Repository root, `apps/api`, `scripts/`, `test/`, Docker & deployment files | `AGPL-3.0-or-later` | [`LICENSE`](./LICENSE) and [`apps/api/LICENSE`](./apps/api/LICENSE) |
| `packages/shared` (`@entsiegelung/shared`) | `MPL-2.0` | [`packages/shared/LICENSE`](./packages/shared/LICENSE) |
| `apps/mobile` (`@entsiegelung/mobile`) | `MPL-2.0` | [`apps/mobile/LICENSE`](./apps/mobile/LICENSE) |

* **Server & Repository Components (`AGPL-3.0-or-later`):** Except where a workspace directory provides its own `LICENSE` file, this repository (including `apps/api`) is free software licensed under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version (`AGPL-3.0-or-later`).
* **Client & Shared Contract Packages (`MPL-2.0`):** `packages/shared` and `apps/mobile` are licensed separately under the Mozilla Public License Version 2.0 (`MPL-2.0`), without the Exhibit B "Incompatible With Secondary Licenses" notice. Under MPL-2.0 Section 3.3, `apps/api` may combine `@entsiegelung/shared` into an `AGPL-3.0-or-later` work while `@entsiegelung/shared` itself remains available under `MPL-2.0`.

---

## 2. AGPLv3 Section 13 Network-Interaction Clarification

For the avoidance of doubt regarding Section 13 of the GNU Affero General Public License, client packages and applications licensed under `MPL-2.0` (including `packages/shared` and `apps/mobile`, as well as independent HTTP or GeoJSON API clients) that communicate with the `apps/api` HTTP service over a computer network are separate works and remain covered by `MPL-2.0` (or their respective licenses). Communicating with the HTTP API over a network does not cause `MPL-2.0` client packages to become derivative or combined works under the GNU Affero General Public License.

Operators running a modified version of `apps/api` that interacts with users over a network must prominently offer Corresponding Source under AGPLv3 Section 13 (configured via `SOURCE_CODE_URL`, surfaced on `/auth/impressum`, `/auth/licenses`, `/api/v1/config`, and the client's About dialog).

---

## 3. Third-Party Software & Runtime Stack Notices

Complete third-party npm dependency licenses, copyright notices, full permissive license texts for bundled libraries, native mobile SDK licenses (including MapLibre Native Android/iOS under `BSD-2-Clause` and MapLibre React Native under `MIT`), `@img/sharp-libvips` bundled C libraries, and Docker runtime stack components (`Node.js`, `PostgreSQL`, `PostGIS`, `Caddy`, `Mailpit`) are documented in [`THIRD_PARTY_NOTICES.txt`](./THIRD_PARTY_NOTICES.txt) (regenerated via `npm run licenses:generate` and served at `/auth/third-party-notices`).

---

## 4. User-Contributed Content & Geodata Licenses

* **User-mapped polygon geometries, surface classifications, and site notes:** Dedicated under [Creative Commons Zero 1.0 Universal (`CC0-1.0`)](https://creativecommons.org/publicdomain/zero/1.0/) for open public GeoJSON reuse (`GET /api/v1/polygons/export.geojson`). Admin bulk imports (`.geojson` / `.gpkg`) enter the same `CC0-1.0` export and must therefore only contain data eligible for `CC0-1.0` release.
* **User-uploaded site photos and comments:** Licensed under [Creative Commons Attribution 4.0 International (`CC BY 4.0`)](https://creativecommons.org/licenses/by/4.0/) with attribution to the contributor's public pseudonym (or anonymized as `deleted` upon user-initiated account deletion without content purge). Photos are modified on upload (EXIF/XMP/IPTC stripped and re-encoded/resized to WebP).
* **Default external geodata & map sources:**
  * Basemap tiles & schema: **OpenFreeMap** (`MIT`), **© OpenMapTiles** (`CC BY 4.0` / `BSD-3-Clause`), **© OpenStreetMap contributors** (`ODbL`).
  * Address geocoding: **OpenStreetMap Nominatim** (`ODbL`).
  * German municipality boundaries (`VG250`): **© BKG** (`https://www.bkg.bund.de`), [Datenlizenz Deutschland – Namensnennung 2.0 (`dl-de/by-2-0`)](https://www.govdata.de/dl-de/by-2-0), *Daten verändert*.
  * Built-in German state aerial orthophotos (`DOP20` / `DOP10`): Provided by the 16 German state survey offices under their respective Open Data licenses (`dl-de/by-2-0`, `CC BY 4.0`, and `dl-de/zero-2-0`; *Daten verändert* at cross-state tile boundaries). Per-state agency credits and license links are listed in [`THIRD_PARTY_NOTICES.txt`](./THIRD_PARTY_NOTICES.txt) and dynamically on `/auth/licenses`.
