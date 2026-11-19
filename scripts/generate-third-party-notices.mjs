// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function packageNameFromLockKey(lockKey) {
  const parts = lockKey.split('node_modules/');
  return parts[parts.length - 1] ?? lockKey;
}

function detectLicenseFromText(text) {
  if (/The MIT License|Permission is hereby granted, free of charge/i.test(text)) {
    if (!/The above copyright notice and this permission notice shall be included/i.test(text)) {
      return 'MIT-0';
    }
    return 'MIT';
  }
  if (/Apache License\s+Version 2\.0/i.test(text)) {
    return 'Apache-2.0';
  }
  if (/Mozilla Public License Version 2\.0/i.test(text)) {
    return 'MPL-2.0';
  }
  if (/ISC License/i.test(text)) {
    return 'ISC';
  }
  if (/BSD 3-Clause|Neither the name of .* nor the names of its contributors/i.test(text)) {
    return 'BSD-3-Clause';
  }
  if (/BSD 2-Clause|Redistributions in binary form must reproduce/i.test(text)) {
    return 'BSD-2-Clause';
  }
  return null;
}

function findLicenseFile(pkgDir) {
  if (!fs.existsSync(pkgDir)) {
    return null;
  }
  const candidates = fs
    .readdirSync(pkgDir)
    .filter((f) => /^(?:licen[cs]e|copying|notice)(?:\.(?:txt|md))?$/i.test(f))
    .sort((a, b) => a.localeCompare(b));
  for (const name of candidates) {
    const full = path.join(pkgDir, name);
    if (fs.statSync(full).isFile()) {
      return full;
    }
  }
  return null;
}

function resolvePackageLicense(lockKey, entry) {
  if (typeof entry.license === 'string' && entry.license.trim().length > 0) {
    return entry.license.trim();
  }
  const pkgDir = path.join(REPO_ROOT, lockKey);
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
  const licFile = findLicenseFile(pkgDir);
  if (licFile) {
    const detected = detectLicenseFromText(fs.readFileSync(licFile, 'utf8'));
    if (detected) {
      return detected;
    }
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

function main() {
  const lock = readJson(path.join(REPO_ROOT, 'package-lock.json'));
  const pkgs = lock.packages ?? {};

  const workspaces = [
    { dir: 'packages/shared', label: 'packages/shared (@entsiegelung/shared, MPL-2.0)' },
    { dir: 'apps/api', label: 'apps/api (@entsiegelung/api, AGPL-3.0-or-later)' },
    { dir: 'apps/mobile', label: 'apps/mobile (@entsiegelung/mobile, MPL-2.0)' },
  ];

  const lines = [];
  const hr = '='.repeat(80);
  const subHr = '-'.repeat(80);

  lines.push('UNSEAL (ENTSIEGELUNGSKARTIERUNG) - THIRD-PARTY SOFTWARE & GEODATA NOTICES');
  lines.push(hr);
  lines.push('');
  lines.push('This document records the third-party software packages, native mobile SDKs,');
  lines.push('runtime container components, and default geodata sources used by Unseal.');
  lines.push('Regenerate from package-lock.json and node_modules via:');
  lines.push('  npm run licenses:generate');
  lines.push('');
  lines.push('Project licenses: see LICENSE (AGPL-3.0-or-later), apps/api/LICENSE,');
  lines.push('apps/mobile/LICENSE (MPL-2.0), packages/shared/LICENSE (MPL-2.0), and LICENSING.md.');
  lines.push('');

  // Section 1: Direct production dependencies per workspace
  lines.push(hr);
  lines.push('1. DIRECT RUNTIME DEPENDENCIES BY WORKSPACE');
  lines.push(hr);
  lines.push('');

  const directNoticeTargets = new Map();

  for (const ws of workspaces) {
    const manifest = readJson(path.join(REPO_ROOT, ws.dir, 'package.json'));
    lines.push(ws.label);
    lines.push(subHr);
    const deps = Object.keys(manifest.dependencies ?? {}).sort((a, b) => a.localeCompare(b));
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
      if (!directNoticeTargets.has(`${dep}@${depPkg.version}`)) {
        directNoticeTargets.set(`${dep}@${depPkg.version}`, {
          name: dep,
          version: depPkg.version,
          license: lic,
          dir: depDir,
          homepage: depPkg.homepage ?? depPkg.repository?.url ?? '',
        });
      }
    }
    lines.push('');
  }

  // Section 2: Reproduced license & copyright texts for direct runtime dependencies
  lines.push(hr);
  lines.push('2. REPRODUCED COPYRIGHT & LICENSE NOTICES FOR DIRECT RUNTIME PACKAGES');
  lines.push(hr);
  lines.push('');

  for (const [, info] of [...directNoticeTargets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`--- ${info.name}@${info.version} (${info.license}) ---`);
    if (info.homepage) {
      lines.push(`Source: ${info.homepage}`);
    }
    const licFile = findLicenseFile(info.dir);
    if (licFile) {
      const content = fs.readFileSync(licFile, 'utf8').trim();
      lines.push('');
      lines.push(content);
    } else {
      lines.push('');
      lines.push(
        `License declared in package.json: ${info.license} (upstream package does not bundle a standalone LICENSE file in its npm tarball).`,
      );
    }
    lines.push('');
  }

  // Section 2b: Bundled native C libraries inside @img/sharp-libvips-*
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
  lines.push('Copyright (c) MapLibre contributors. All rights reserved.');
  lines.push('Redistribution and use in source and binary forms, with or without modification,');
  lines.push('are permitted provided that the following conditions are met:');
  lines.push('1. Redistributions of source code must retain the above copyright notice, this');
  lines.push('   list of conditions and the following disclaimer.');
  lines.push('2. Redistributions in binary form must reproduce the above copyright notice,');
  lines.push('   this list of conditions and the following disclaimer in the documentation');
  lines.push('   and/or other materials provided with the distribution.');
  lines.push('THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND');
  lines.push('ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED.');
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
  lines.push('  - OpenStreetMap Map Data & Nominatim Geocoding : ODbL (https://www.openstreetmap.org/copyright)');
  lines.push('  - OpenMapTiles Vector Tile Schema & Styles : CC BY 4.0 / BSD-3-Clause (https://openmaptiles.org/)');
  lines.push('  - OpenFreeMap Hosting & Tooling : MIT (https://openfreemap.org/)');
  lines.push('  - German Municipality Boundaries (BKG VG250) : dl-de/by-2-0');
  lines.push('      Attribution: © BKG (https://www.bkg.bund.de), dl-de/by-2-0 (https://www.govdata.de/dl-de/by-2-0), Daten verändert');
  lines.push('  - Built-in German State Aerial Orthophotos (DOP20 / DOP10, Daten verändert at state-border tile composites):');
  lines.push('      * RP  (Rheinland-Pfalz)        : dl-de/by-2-0   | © GeoBasis-DE / LVermGeoRP');
  lines.push('      * HE  (Hessen)                 : dl-de/zero-2-0 | © Hessische Verwaltung für Bodenmanagement und Geoinformation (HVBG)');
  lines.push('      * NW  (Nordrhein-Westfalen)    : dl-de/zero-2-0 | © Land NRW (Geobasis NRW)');
  lines.push('      * BW  (Baden-Württemberg)      : dl-de/by-2-0   | © LGL, www.lgl-bw.de');
  lines.push('      * BY  (Bayern)                 : CC BY 4.0      | Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de');
  lines.push('      * SL  (Saarland)               : dl-de/by-2-0   | © GeoBasis-DE / LVGL-SL');
  lines.push('      * BE/BB (Berlin / Brandenburg) : dl-de/by-2-0   | © GeoBasis-DE / LGB (Brandenburg) & Geoportal Berlin');
  lines.push('      * HH  (Hamburg)                : dl-de/by-2-0   | © Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV)');
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
  const targets = [
    path.join(REPO_ROOT, 'THIRD_PARTY_NOTICES.txt'),
    path.join(REPO_ROOT, 'apps/mobile/public/THIRD_PARTY_NOTICES.txt'),
  ];
  for (const targetPath of targets) {
    fs.writeFileSync(targetPath, outputText, 'utf8');
  }
  console.log(
    `Generated ${targets.map((p) => path.relative(REPO_ROOT, p)).join(', ')} (${uniquePackages.size} unique npm packages, ${licenseSummary.size} distinct license expressions).`,
  );
}

main();
