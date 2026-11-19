// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

// Build-time CLI / bundler packages nested under `expo` dependencies that are not
// shipped inside the runtime Web bundle or mobile app binaries.
const BUILD_ONLY_SKIPS = new Set([
  '@expo/cli',
  '@expo/metro-config',
  'metro',
  'metro-config',
  'babel-preset-expo',
  '@react-native/community-cli-plugin',
  '@react-native-community/cli',
  'jsc-android',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function packageNameFromLockKey(lockKey) {
  const parts = lockKey.split('node_modules/');
  return parts[parts.length - 1] ?? lockKey;
}

function detectLicensesInText(rawText) {
  const norm = rawText.replace(/\s+/g, ' ').trim();
  const found = new Set();
  if (
    /Zero-Clause BSD|Permission to use, copy, modify, and\/or distribute.{1,250}?without fee is hereby granted\.\s*THE SOFTWARE IS PROVIDED/i.test(
      norm,
    )
  ) {
    found.add('0BSD');
  }
  if (/The MIT License|Permission is hereby granted, free of charge/i.test(norm)) {
    if (
      /The above copyright notice and (?:this|the) permission notice(?:s)? shall be included/i.test(
        norm,
      )
    ) {
      found.add('MIT');
    } else {
      found.add('MIT-0');
    }
  }
  if (/Apache License.{0,60}?Version 2\.0/i.test(norm)) {
    found.add('Apache-2.0');
  }
  if (/Mozilla Public License.{0,30}?Version 2\.0/i.test(norm)) {
    found.add('MPL-2.0');
  }
  if (/GNU LESSER GENERAL PUBLIC LICENSE.{0,80}?Version 3/i.test(norm)) {
    found.add('LGPL-3.0-or-later');
  }
  if (/Blue Oak Model License.{0,60}?Version 1\.0\.0/i.test(norm)) {
    found.add('BlueOak-1.0.0');
  }
  if (/This is free and unencumbered software released into the public domain/i.test(norm)) {
    found.add('Unlicense');
  }
  if (
    /ISC License|Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice/i.test(
      norm,
    )
  ) {
    found.add('ISC');
  }
  const hasBsd3 =
    /BSD 3-Clause|Neither the name of .{1,160}? nor the names of (?:its|their|other) contributors/i.test(
      norm,
    );
  if (hasBsd3) {
    found.add('BSD-3-Clause');
  }
  if (!hasBsd3 && /BSD 2-Clause|Redistributions in binary form must reproduce/i.test(norm)) {
    found.add('BSD-2-Clause');
  }
  return found;
}

const CODE_OR_META_EXT_RE = /\.(?:[cm]?[jt]sx?|json|map|wasm|node|sh|cmd|ps1|h|c|cc|cpp|py|rb|java|kt|swift|podspec|gradle)$/i;

function findLicenseAndNoticeFiles(pkgDir) {
  if (!fs.existsSync(pkgDir)) {
    return { licenseFiles: [], noticeFiles: [] };
  }
  const files = fs
    .readdirSync(pkgDir)
    .filter((f) => !CODE_OR_META_EXT_RE.test(f) && fs.statSync(path.join(pkgDir, f)).isFile())
    .sort((a, b) => a.localeCompare(b));
  const licenseFiles = files
    .filter((f) => /^(?:licen[cs]es?|copying|unlicense|copyright)(?:[-._].*)?$/i.test(f))
    .map((f) => path.join(pkgDir, f));
  const noticeFiles = files
    .filter((f) => /^notice(?:[-._].*)?$/i.test(f))
    .map((f) => path.join(pkgDir, f));
  return { licenseFiles, noticeFiles };
}

function readDeclaredPackageLicense(pkgDir, entry) {
  if (typeof entry.license === 'string' && entry.license.trim().length > 0) {
    return entry.license.trim();
  }
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    const pkgJson = readJson(pkgJsonPath);
    if (typeof pkgJson.license === 'string' && pkgJson.license.trim().length > 0) {
      return pkgJson.license.trim();
    }
    if (pkgJson.license && typeof pkgJson.license.type === 'string') {
      return pkgJson.license.type.trim();
    }
    if (typeof pkgJson.licenses === 'string' && pkgJson.licenses.trim().length > 0) {
      return pkgJson.licenses.trim();
    }
    if (Array.isArray(pkgJson.licenses) && pkgJson.licenses.length > 0) {
      const types = pkgJson.licenses
        .map((item) => (typeof item === 'string' ? item : item?.type))
        .filter((v) => typeof v === 'string' && v.trim().length > 0)
        .map((v) => (v.trim() === 'Apache 2.0' ? 'Apache-2.0' : v.trim()));
      if (types.length > 0) {
        return types.join(' OR ');
      }
    }
  }
  return null;
}

function resolvePackageLicense(lockKey, entry) {
  const pkgDir = path.join(REPO_ROOT, lockKey);
  const declared = readDeclaredPackageLicense(pkgDir, entry);
  const { licenseFiles } = findLicenseAndNoticeFiles(pkgDir);

  const detectedSet = new Set();
  for (const lf of licenseFiles) {
    for (const detected of detectLicensesInText(fs.readFileSync(lf, 'utf8'))) {
      detectedSet.add(detected);
    }
  }

  if (
    declared &&
    licenseFiles.length === 1 &&
    detectedSet.size === 1 &&
    !/\b(?:OR|AND)\b/i.test(declared)
  ) {
    const [soleDetected] = [...detectedSet];
    const normDeclared = declared.replace(/^BSD$/, 'BSD-2-Clause');
    if (
      soleDetected &&
      !detectedSet.has(normDeclared) &&
      !(declared === 'BSD-3-Clause' && soleDetected === 'BSD-2-Clause') &&
      !(declared === 'ISC' && soleDetected === 'MIT') &&
      !(declared === 'MIT' && soleDetected === 'ISC')
    ) {
      return `${soleDetected} [LICENSE file; package.json declares ${declared}]`;
    }
  }

  if (declared) {
    return declared;
  }
  if (detectedSet.size > 0) {
    return [...detectedSet].join(' OR ');
  }
  return 'UNKNOWN';
}

function resolveDirectDepDir(workspaceDir, depName) {
  const candidates = [
    path.join(REPO_ROOT, workspaceDir, 'node_modules', depName),
    path.join(REPO_ROOT, 'node_modules', depName),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
  }
  return null;
}

function resolveLockKey(pkgs, fromPath, depName) {
  let parts = fromPath ? fromPath.split('/') : [];
  while (true) {
    const candidate = `${parts.length ? `${parts.join('/')}/` : ''}node_modules/${depName}`;
    if (pkgs[candidate]) {
      return candidate;
    }
    if (parts.length === 0) {
      return null;
    }
    const idx = parts.lastIndexOf('node_modules');
    parts = idx === -1 ? [] : parts.slice(0, idx);
  }
}

function collectRuntimeLockKeys(pkgs, workspaceDir, depNames, skipNames = new Set()) {
  const visited = new Set();
  const queue = [];
  for (const dep of depNames) {
    if (dep.startsWith('@entsiegelung/') || skipNames.has(dep)) {
      continue;
    }
    const key = resolveLockKey(pkgs, workspaceDir, dep);
    if (key) {
      queue.push(key);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    const entry = pkgs[current];
    if (!entry) {
      continue;
    }
    for (const group of ['dependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(entry[group] ?? {})) {
        if (dep.startsWith('@entsiegelung/') || skipNames.has(dep)) {
          continue;
        }
        const nextKey = resolveLockKey(pkgs, current, dep);
        if (nextKey && !visited.has(nextKey)) {
          queue.push(nextKey);
        }
      }
    }
  }
  return visited;
}

function main() {
  const lock = readJson(path.join(REPO_ROOT, 'package-lock.json'));
  const pkgs = lock.packages ?? {};

  const workspaces = [
    {
      dir: 'packages/shared',
      label: 'packages/shared (@entsiegelung/shared, MPL-2.0)',
      skipNames: new Set(),
    },
    {
      dir: 'apps/api',
      label: 'apps/api (@entsiegelung/api, AGPL-3.0-or-later)',
      skipNames: new Set(),
    },
    {
      dir: 'apps/mobile',
      label: 'apps/mobile (@entsiegelung/mobile, MPL-2.0)',
      skipNames: BUILD_ONLY_SKIPS,
    },
  ];

  const lines = [];
  const hr = '='.repeat(80);
  const subHr = '-'.repeat(80);

  lines.push('UNSEAL (ENTSIEGELUNGSKARTIERUNG) - THIRD-PARTY SOFTWARE & GEODATA NOTICES');
  lines.push(hr);
  lines.push('');
  lines.push('This document records the third-party software packages, reproduced runtime');
  lines.push('copyright/license notices (direct and transitive), native mobile SDKs,');
  lines.push('runtime container components, and default geodata sources used by Unseal.');
  lines.push('Regenerate from package-lock.json and node_modules via:');
  lines.push('  npm run licenses:generate');
  lines.push('');
  lines.push('Project licenses: see LICENSE (AGPL-3.0-or-later), apps/mobile/LICENSE (MPL-2.0),');
  lines.push('packages/shared/LICENSE (MPL-2.0), and LICENSING.md.');
  lines.push('');

  // Section 1: Direct production dependencies per workspace
  lines.push(hr);
  lines.push('1. DIRECT RUNTIME DEPENDENCIES BY WORKSPACE');
  lines.push(hr);
  lines.push('');

  const allRuntimeLockKeys = new Set();

  for (const ws of workspaces) {
    const manifest = readJson(path.join(REPO_ROOT, ws.dir, 'package.json'));
    lines.push(ws.label);
    lines.push(subHr);
    const deps = Object.keys(manifest.dependencies ?? {}).sort((a, b) => a.localeCompare(b));
    for (const key of collectRuntimeLockKeys(pkgs, ws.dir, deps, ws.skipNames)) {
      allRuntimeLockKeys.add(key);
    }
    for (const dep of deps) {
      if (dep.startsWith('@entsiegelung/')) {
        lines.push(`  - ${dep} (workspace package; MPL-2.0)`);
        continue;
      }
      const depDir = resolveDirectDepDir(ws.dir, dep);
      if (!depDir) {
        lines.push(`  - ${dep}: (not installed in node_modules)`);
        continue;
      }
      const depPkg = readJson(path.join(depDir, 'package.json'));
      const relKey = path.relative(REPO_ROOT, depDir).replace(/\\/g, '/');
      const lic = resolvePackageLicense(relKey, depPkg);
      lines.push(`  - ${dep}@${depPkg.version} : ${lic}`);
    }
    lines.push('');
  }

  // Section 2: Reproduced copyright & license texts for ALL runtime packages
  // (direct + transitive across shared, api, and mobile bundled runtime libs).
  // Byte-identical license texts are grouped so every package copyright notice
  // and NOTICE file is preserved verbatim without duplicating identical text blocks.
  const runtimePackagesById = new Map();
  for (const lockKey of allRuntimeLockKeys) {
    const entry = pkgs[lockKey];
    if (!entry || entry.link) {
      continue;
    }
    const name = packageNameFromLockKey(lockKey);
    const version = entry.version ?? 'unknown';
    const id = `${name}@${version}`;
    if (runtimePackagesById.has(id)) {
      continue;
    }
    const dir = path.join(REPO_ROOT, lockKey);
    const license = resolvePackageLicense(lockKey, entry);
    runtimePackagesById.set(id, { id, name, version, license, dir });
  }

  const groupedByNoticeText = new Map();
  const packagesWithoutStandaloneLicenseFile = [];

  for (const info of [...runtimePackagesById.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const { licenseFiles, noticeFiles } = findLicenseAndNoticeFiles(info.dir);
    const parts = [];
    for (const lf of licenseFiles) {
      const content = fs.readFileSync(lf, 'utf8').replace(/\r\n/g, '\n').trim();
      if (!content) {
        continue;
      }
      if (licenseFiles.length > 1) {
        parts.push(`[${path.basename(lf)}]\n${content}`);
      } else {
        parts.push(content);
      }
    }
    for (const nf of noticeFiles) {
      const content = fs.readFileSync(nf, 'utf8').replace(/\r\n/g, '\n').trim();
      if (!content) {
        continue;
      }
      const header = noticeFiles.length > 1 ? `[NOTICE: ${path.basename(nf)}]` : '[NOTICE]';
      parts.push(`${header}\n${content}`);
    }
    if (parts.length === 0) {
      packagesWithoutStandaloneLicenseFile.push(info);
      continue;
    }
    const combinedText = parts.join('\n\n');
    if (!groupedByNoticeText.has(combinedText)) {
      groupedByNoticeText.set(combinedText, []);
    }
    groupedByNoticeText.get(combinedText).push(`${info.id} (${info.license})`);
  }

  const sortedNoticeGroups = [...groupedByNoticeText.entries()].sort((a, b) =>
    a[1][0].localeCompare(b[1][0]),
  );

  lines.push(hr);
  lines.push('2. REPRODUCED COPYRIGHT & LICENSE NOTICES FOR RUNTIME PACKAGES (DIRECT & TRANSITIVE)');
  lines.push(hr);
  lines.push('');
  lines.push(
    `Covering ${runtimePackagesById.size} unique runtime packages across packages/shared, apps/api, and apps/mobile`,
  );
  lines.push(
    `(${sortedNoticeGroups.length} distinct verbatim license/NOTICE texts; ${packagesWithoutStandaloneLicenseFile.length} packages declare a license in package.json without a standalone LICENSE file in their npm tarball).`,
  );
  lines.push('');

  for (const [text, pkgLabels] of sortedNoticeGroups) {
    lines.push(`--- ${pkgLabels.join(', ')} ---`);
    lines.push('');
    lines.push(text);
    lines.push('');
  }

  if (packagesWithoutStandaloneLicenseFile.length > 0) {
    lines.push('--- Runtime packages without a standalone LICENSE file in their npm tarball ---');
    lines.push('');
    for (const info of packagesWithoutStandaloneLicenseFile) {
      lines.push(`  - ${info.id} : ${info.license} (declared in package.json)`);
    }
    lines.push('');
  }

  // Section 3: Bundled native C libraries inside @img/sharp-libvips-*
  const sharpLibvipsReadme = path.join(
    REPO_ROOT,
    'node_modules/@img/sharp-libvips-linux-x64/README.md',
  );
  lines.push(hr);
  lines.push('3. PREBUILT LIBVIPS & BUNDLED NATIVE LIBRARIES (@img/sharp-libvips-*)');
  lines.push(hr);
  lines.push('');
  lines.push('sharp@0.35.5 (Apache-2.0) dynamically loads platform-specific @img/sharp-libvips-*');
  lines.push('prebuilt binaries distributed under LGPL-3.0-or-later.');
  if (fs.existsSync(sharpLibvipsReadme)) {
    lines.push('');
    lines.push(fs.readFileSync(sharpLibvipsReadme, 'utf8').trim());
  }
  lines.push('');

  // Section 4: Native Mobile SDKs (Expo Prebuild Android / iOS)
  const mlrnGradleProps = path.join(
    REPO_ROOT,
    'node_modules/@maplibre/maplibre-react-native/android/gradle.properties',
  );
  let androidMapLibreVer = '11.12.1';
  if (fs.existsSync(mlrnGradleProps)) {
    const propsText = fs.readFileSync(mlrnGradleProps, 'utf8');
    const match = /org\.maplibre\.reactnative\.nativeVersion=([^\r\n]+)/.exec(propsText);
    if (match?.[1]) {
      androidMapLibreVer = match[1].trim();
    }
  }
  const mlrnPodspec = path.join(
    REPO_ROOT,
    'node_modules/@maplibre/maplibre-react-native/maplibre-react-native.podspec',
  );
  let iosMapLibreVer = '6.17.1';
  if (fs.existsSync(mlrnPodspec)) {
    const podText = fs.readFileSync(mlrnPodspec, 'utf8');
    const match = /\$MLRN_NATIVE_VERSION\s*\|\|=\s*"([^"]+)"/.exec(podText);
    if (match?.[1]) {
      iosMapLibreVer = match[1].trim();
    }
  }

  lines.push(hr);
  lines.push('4. NATIVE MOBILE SDK DEPENDENCIES (ANDROID / iOS PREBUILD)');
  lines.push(hr);
  lines.push('');
  lines.push('When building native Android/iOS packages via `npx expo prebuild`, the following');
  lines.push('native SDKs are linked in addition to the npm packages listed above:');
  lines.push('');
  lines.push(`  - MapLibre Native Android SDK (org.maplibre.gl:android-sdk-opengl:${androidMapLibreVer}) : BSD-2-Clause`);
  lines.push(`  - MapLibre Native iOS Distribution (maplibre-gl-native-distribution ${iosMapLibreVer}) : BSD-2-Clause`);
  lines.push('  - React Native Android / Hermes Runtime (com.facebook.react:react-android, hermes-android) : MIT');
  lines.push('  - Fresco Image Pipeline (com.facebook.fresco) : MIT');
  lines.push('  - Kotlin Standard Library (org.jetbrains.kotlin:kotlin-stdlib) : Apache-2.0');
  lines.push('  - AndroidX & OkHttp libraries : Apache-2.0');
  lines.push('');
  lines.push('--- MapLibre Native (BSD-2-Clause) ---');
  lines.push('BSD 2-Clause License');
  lines.push('');
  lines.push('Copyright (c) 2021 MapLibre contributors');
  lines.push('Copyright (c) 2018-2021 MapTiler.com');
  lines.push('Copyright (c) 2014-2020 Mapbox');
  lines.push('');
  lines.push('Redistribution and use in source and binary forms, with or without');
  lines.push('modification, are permitted provided that the following conditions are met:');
  lines.push('');
  lines.push('1. Redistributions of source code must retain the above copyright notice, this');
  lines.push('   list of conditions and the following disclaimer.');
  lines.push('');
  lines.push('2. Redistributions in binary form must reproduce the above copyright notice,');
  lines.push('   this list of conditions and the following disclaimer in the documentation');
  lines.push('   and/or other materials provided with the distribution.');
  lines.push('');
  lines.push('THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"');
  lines.push('AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE');
  lines.push('IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE');
  lines.push('DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE');
  lines.push('FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL');
  lines.push('DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR');
  lines.push('SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER');
  lines.push('CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,');
  lines.push('OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE');
  lines.push('OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.');
  lines.push('');

  // Section 5: Docker & Runtime Stack Components
  lines.push(hr);
  lines.push('5. DOCKER & RUNTIME INFRASTRUCTURE COMPONENTS');
  lines.push(hr);
  lines.push('');
  lines.push('  - Node.js 24 (node:24-bookworm-slim) : MIT (plus Debian Bookworm base OS packages)');
  lines.push('  - PostgreSQL 16 (postgis/postgis:16-3.4-alpine) : PostgreSQL License');
  lines.push('  - PostGIS 3.4 : GPL-2.0-or-later (bundles GEOS LGPL-2.1-or-later, GDAL MIT, PROJ MIT)');
  lines.push('  - Caddy 2 (caddy:2-alpine, VPS reverse proxy) : Apache-2.0');
  lines.push('  - Mailpit (axllent/mailpit:v1.21, local development only) : MIT');
  lines.push('');

  // Section 6: Default Geodata & Map Sources
  lines.push(hr);
  lines.push('6. DEFAULT GEODATA & EXTERNAL MAP SOURCES');
  lines.push(hr);
  lines.push('');
  lines.push('  - OpenStreetMap Map Data & Nominatim Geocoding : ODbL-1.0 (https://www.openstreetmap.org/copyright)');
  lines.push('  - OpenMapTiles Vector Tile Schema & Styles : CC BY 4.0 / BSD-3-Clause (https://openmaptiles.org/)');
  lines.push('  - Natural Earth Low-Zoom Shaded Relief (via OpenFreeMap styles) : Public Domain (https://www.naturalearthdata.com/)');
  lines.push('  - Noto Sans Map Label Font Glyphs (via OpenFreeMap styles) : SIL OFL 1.1 (https://openfontlicense.org/)');
  lines.push('  - OpenFreeMap Hosting & Tooling : MIT (https://openfreemap.org/)');
  lines.push('  - German Municipality Boundaries (BKG VG250) : dl-de/by-2-0');
  lines.push('      Attribution: © GeoBasis-DE / BKG (<year of data retrieval>) dl-de/by-2-0 (https://www.govdata.de/dl-de/by-2-0),');
  lines.push('      Datenquellen: https://sg.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf (Daten verändert)');
  lines.push('  - Built-in German State Aerial Orthophotos (DOP20 / DOP10, Daten verändert at state-border tile composites):');
  lines.push('      * RP  (Rheinland-Pfalz)        : dl-de/by-2-0   | © GeoBasis-DE / LVermGeoRP, http://www.lvermgeo.rlp.de');
  lines.push('      * HE  (Hessen)                 : dl-de/zero-2-0 | © Hessische Verwaltung für Bodenmanagement und Geoinformation (HVBG)');
  lines.push('      * NW  (Nordrhein-Westfalen)    : dl-de/zero-2-0 | © Land NRW (Geobasis NRW)');
  lines.push('      * BW  (Baden-Württemberg)      : dl-de/by-2-0   | © LGL, www.lgl-bw.de');
  lines.push('      * BY  (Bayern)                 : CC BY 4.0      | Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de');
  lines.push('      * SL  (Saarland)               : dl-de/by-2-0   | © GeoBasis-DE / LVGL-SL');
  lines.push('      * BE/BB (Berlin / Brandenburg) : dl-de/by-2-0   | © GeoBasis-DE / LGB, dl-de/by-2-0; © Geoportal Berlin, dl-de/by-2-0');
  lines.push('      * HH  (Hamburg, TIME=2026)     : dl-de/by-2-0   | © Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV)');
  lines.push('                                       (pinned to LGV OpenData aerial vintage TIME=2026; excludes 2023 Maxar satellite vintage)');
  lines.push('      * NI  (Niedersachsen)          : CC BY 4.0      | © LGLN (Niedersachsen)');
  lines.push('      * HB  (Bremen / Bremerhaven)   : CC BY 4.0      | © Landesamt GeoInformation Bremen');
  lines.push('      * SH  (Schleswig-Holstein)     : CC BY 4.0      | © GeoBasis-DE / LVermGeo SH');
  lines.push('      * MV  (Mecklenburg-Vorpommern) : CC BY 4.0      | © GeoBasis-DE / M-V');
  lines.push('      * SN  (Sachsen)                : dl-de/by-2-0   | © GeoBasis-DE / GeoSN');
  lines.push('      * ST  (Sachsen-Anhalt)         : dl-de/by-2-0   | © GeoBasis-DE / LVermGeo ST');
  lines.push('      * TH  (Thüringen)              : CC BY 4.0      | © GDI-Th');
  lines.push('      License URLs:');
  lines.push('        - dl-de/by-2-0   : https://www.govdata.de/dl-de/by-2-0');
  lines.push('        - dl-de/zero-2-0 : https://www.govdata.de/dl-de/zero-2-0');
  lines.push('        - CC BY 4.0      : https://creativecommons.org/licenses/by/4.0/');
  lines.push('  - User-Contributed & Exported Platform Content:');
  lines.push('      * Compiled Polygon Dataset Export (/api/v1/polygons/export.geojson) : ODbL-1.0 (https://opendatacommons.org/licenses/odbl/1-0/)');
  lines.push('        with upstream OpenStreetMap (ODbL), BKG VG250 (dl-de/by-2-0), and German State DOP20/DOP10 attributions.');
  lines.push('      * Contributor Rights Waiver on Own Polygon Input & Notes            : CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)');
  lines.push('      * Uploaded Ground-Truth Photos & Discussion Comments                : CC BY 4.0 (attributed to contributor pseudonym)');
  lines.push('');

  // Section 7: Complete inventory of all npm lockfile packages
  lines.push(hr);
  lines.push('7. COMPLETE NPM DEPENDENCY LICENSE INVENTORY (FROM package-lock.json)');
  lines.push(hr);
  lines.push('');

  const uniquePackages = new Map();
  for (const [lockKey, entry] of Object.entries(pkgs)) {
    if (!lockKey.startsWith('node_modules/') || entry.link) {
      continue;
    }
    const name = packageNameFromLockKey(lockKey);
    if (name.startsWith('@entsiegelung/')) {
      continue;
    }
    const version = entry.version ?? 'unknown';
    const license = resolvePackageLicense(lockKey, entry);
    const id = `${name}@${version}`;
    if (!uniquePackages.has(id)) {
      uniquePackages.set(id, { name, version, license, dev: Boolean(entry.dev) });
    }
  }

  const licenseSummary = new Map();
  for (const item of uniquePackages.values()) {
    licenseSummary.set(item.license, (licenseSummary.get(item.license) ?? 0) + 1);
  }

  lines.push(`Total unique third-party npm packages: ${uniquePackages.size}`);
  lines.push('License breakdown:');
  for (const [lic, count] of [...licenseSummary.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    lines.push(`  - ${lic}: ${count}`);
  }
  lines.push('');
  lines.push('Packages:');
  for (const [, item] of [...uniquePackages.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const scopeTag = item.dev ? ' [dev]' : '';
    lines.push(`  ${item.name}@${item.version} | ${item.license}${scopeTag}`);
  }
  lines.push('');

  const outputText = `${lines.join('\n')}`;
  const targetPath = path.join(REPO_ROOT, 'THIRD_PARTY_NOTICES.txt');
  fs.writeFileSync(targetPath, outputText, 'utf8');
  console.log(
    `Generated ${path.relative(REPO_ROOT, targetPath)} (${runtimePackagesById.size} runtime packages / ${sortedNoticeGroups.length} verbatim license texts; ${uniquePackages.size} total npm packages).`,
  );
}

main();
