// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

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
    /BSD 3-Clause|endorse or promote products derived from this software without specific prior written permission/i.test(
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
    return { licenseFiles: [], noticeFiles: [], readmeFiles: [] };
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
  const readmeFiles = files
    .filter((f) => /^readme(?:[-._].*)?$/i.test(f))
    .map((f) => path.join(pkgDir, f));
  return { licenseFiles, noticeFiles, readmeFiles };
}

function extractReadmeVerbatimLicenseBlock(readmePath) {
  const raw = fs.readFileSync(readmePath, 'utf8').replace(/\r\n/g, '\n');
  const decoded = raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const match =
    /(Copyright\s*(?:\(c\)|©)[^\n]*\n+[\s\S]{80,2500}?(?:DEALINGS IN THE SOFTWARE\.|EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE\.))/i.exec(
      decoded,
    );
  if (match?.[1]) {
    return match[1].trim();
  }
  return null;
}

function extractFallbackCopyrightCredit(pkgDir, pkgName, readmeFiles) {
  for (const rf of readmeFiles) {
    const raw = fs
      .readFileSync(rf, 'utf8')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.replace(/^[#>*\s-]+/, '').trim();
      if (/^copyright\s*(?:\(c\)|©|\d{4})/i.test(trimmed) && !trimmed.includes('|')) {
        return trimmed;
      }
    }
  }

  const pkgJsonPath = path.join(pkgDir, 'package.json');
  let pkgJson = null;
  if (fs.existsSync(pkgJsonPath)) {
    pkgJson = readJson(pkgJsonPath);
    const entryCandidates = [
      pkgJson.main,
      pkgJson.module,
      'index.js',
      'build/index.js',
      'src/index.ts',
      'src/index.js',
    ].filter((v) => typeof v === 'string' && v.trim().length > 0);

    for (const rel of entryCandidates) {
      const full = path.join(pkgDir, rel);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        const head = fs.readFileSync(full, 'utf8').slice(0, 1500);
        const copyMatch = /Copyright\s*(?:\(c\)|©)[^\r\n*]*/i.exec(head);
        if (copyMatch?.[0]) {
          return copyMatch[0].trim();
        }
      }
    }

    const author =
      typeof pkgJson.author === 'string'
        ? pkgJson.author.trim()
        : typeof pkgJson.author?.name === 'string'
          ? pkgJson.author.name.trim()
          : '';
    if (author.length > 0) {
      return `Copyright (c) ${author}`;
    }
  }

  if (
    pkgName.startsWith('@react-native/') ||
    pkgName.startsWith('metro-') ||
    pkgName.startsWith('flow-') ||
    pkgName === 'ob1' ||
    pkgName === 'react-devtools-core'
  ) {
    return 'Copyright (c) Meta Platforms, Inc. and affiliates.';
  }
  if (pkgName === 'expo' || pkgName.startsWith('expo-') || pkgName.startsWith('@expo/')) {
    return 'Copyright (c) 650 Industries, Inc. (Expo)';
  }
  if (pkgName.startsWith('buffer-')) {
    return 'Copyright (c) Linus Unnebäck';
  }
  if (pkgName === 'jimp-compact') {
    return 'Copyright (c) Oliver Moran and Jimp contributors';
  }
  if (pkgName.startsWith('@node-rs/argon2')) {
    return 'Copyright (c) LongYinan (@Brooooooklyn) and @node-rs contributors';
  }
  return null;
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
  let primaryDetectedSet = new Set();
  for (const lf of licenseFiles) {
    const rawText = fs.readFileSync(lf, 'utf8');
    for (const detected of detectLicensesInText(rawText)) {
      detectedSet.add(detected);
    }
    if (licenseFiles.length === 1) {
      const primaryBlock = rawText.split(/\n\s*[-=]{10,}\s*\n/)[0] ?? rawText;
      primaryDetectedSet = detectLicensesInText(primaryBlock);
    }
  }

  if (
    declared &&
    licenseFiles.length === 1 &&
    !/\b(?:OR|AND)\b/i.test(declared)
  ) {
    const normDeclared = declared.replace(/^BSD$/, 'BSD-2-Clause');
    if (!detectedSet.has(normDeclared)) {
      const candidateSet =
        detectedSet.size === 1 ? detectedSet : primaryDetectedSet;
      if (candidateSet.size === 1) {
        const [soleDetected] = [...candidateSet];
        if (
          soleDetected &&
          !(declared === 'ISC' && soleDetected === 'MIT') &&
          !(declared === 'MIT' && soleDetected === 'ISC')
        ) {
          return `${soleDetected} [LICENSE file; package.json declares ${declared}]`;
        }
      }
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
    if (dep.startsWith('@openunseal/') || skipNames.has(dep)) {
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
        if (dep.startsWith('@openunseal/') || skipNames.has(dep)) {
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
      label: 'packages/shared (@openunseal/shared, MPL-2.0)',
      skipNames: new Set(),
    },
    {
      dir: 'apps/api',
      label: 'apps/api (@openunseal/api, AGPL-3.0-or-later)',
      skipNames: new Set(),
    },
    {
      dir: 'apps/mobile',
      label: 'apps/mobile (@openunseal/mobile, MPL-2.0)',
      skipNames: BUILD_ONLY_SKIPS,
    },
  ];

  const lines = [];
  const hr = '='.repeat(80);
  const subHr = '-'.repeat(80);

  lines.push('OPENUNSEAL (ENTSIEGELUNGSKARTIERUNG) - THIRD-PARTY SOFTWARE & GEODATA NOTICES');
  lines.push(hr);
  lines.push('');
  lines.push('This document records the third-party software packages, reproduced runtime');
  lines.push('copyright/license notices (direct and transitive), native mobile SDKs,');
  lines.push('runtime container components, and default geodata sources used by OpenUnseal.');
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
      if (dep.startsWith('@openunseal/')) {
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
  const packagesWithoutRootLicenseFile = [];
  const optionalPlatformPackagesNotInstalled = [];

  for (const info of [...runtimePackagesById.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!fs.existsSync(info.dir)) {
      optionalPlatformPackagesNotInstalled.push(info);
      continue;
    }
    const { licenseFiles, noticeFiles, readmeFiles } = findLicenseAndNoticeFiles(info.dir);
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
      for (const rf of readmeFiles) {
        const readmeBlock = extractReadmeVerbatimLicenseBlock(rf);
        if (readmeBlock) {
          parts.push(`[From ${path.basename(rf)}]\n${readmeBlock}`);
          break;
        }
      }
    }
    if (parts.length === 0) {
      const credit = extractFallbackCopyrightCredit(info.dir, info.name, readmeFiles);
      packagesWithoutRootLicenseFile.push({ ...info, credit });
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
    `(${sortedNoticeGroups.length} distinct verbatim license/NOTICE texts; ${packagesWithoutRootLicenseFile.length} installed packages declare a license in package.json without a root LICENSE file; ${optionalPlatformPackagesNotInstalled.length} platform-specific optional packages for other OS/CPU targets are recorded from package-lock.json).`,
  );
  lines.push('');

  for (const [text, pkgLabels] of sortedNoticeGroups) {
    lines.push(`--- ${pkgLabels.join(', ')} ---`);
    lines.push('');
    lines.push(text);
    lines.push('');
  }

  if (packagesWithoutRootLicenseFile.length > 0) {
    lines.push('--- Installed runtime packages without a root LICENSE file in their npm tarball ---');
    lines.push('');
    for (const info of packagesWithoutRootLicenseFile) {
      const creditSuffix = info.credit ? ` — ${info.credit}` : '';
      lines.push(`  - ${info.id} : ${info.license} (declared in package.json)${creditSuffix}`);
    }
    lines.push('');
    lines.push('Standard MIT permission notice for the MIT-licensed packages listed immediately above');
    lines.push('(for `@img/sharp-libvips-*` under LGPL-3.0-or-later, see Section 3 below):');
    lines.push('');
    lines.push('Permission is hereby granted, free of charge, to any person obtaining a copy');
    lines.push('of this software and associated documentation files (the "Software"), to deal');
    lines.push('in the Software without restriction, including without limitation the rights');
    lines.push('to use, copy, modify, merge, publish, distribute, sublicense, and/or sell');
    lines.push('copies of the Software, and to permit persons to whom the Software is');
    lines.push('furnished to do so, subject to the following conditions:');
    lines.push('');
    lines.push('The above copyright notice and this permission notice shall be included in all');
    lines.push('copies or substantial portions of the Software.');
    lines.push('');
    lines.push('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR');
    lines.push('IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,');
    lines.push('FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE');
    lines.push('AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER');
    lines.push('LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,');
    lines.push('OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE');
    lines.push('SOFTWARE.');
    lines.push('');
  }

  if (optionalPlatformPackagesNotInstalled.length > 0) {
    lines.push('--- Platform-specific optional runtime packages for other OS/CPU targets (from package-lock.json) ---');
    lines.push('');
    for (const info of optionalPlatformPackagesNotInstalled) {
      lines.push(`  - ${info.id} : ${info.license} (declared in package-lock.json)`);
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
  lines.push('Note: Source distribution on GitHub and self-hosted network operation of apps/api do not');
  lines.push('distribute prebuilt libvips binaries. If prebuilt Docker images bundling @img/sharp-libvips-*');
  lines.push('are ever distributed publicly, accompany them with verbatim LGPL-3.0 and GPL-3.0 license texts');
  lines.push('and relinking / corresponding source information per LGPL-3.0 Section 4.');
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
  let androidMapLibrePluginVer = '3.0.2';
  let androidMapLibreTurfVer = '6.0.1';
  let androidOkHttpVer = '4.9.0';
  if (fs.existsSync(mlrnGradleProps)) {
    const propsText = fs.readFileSync(mlrnGradleProps, 'utf8');
    const verMatch = /org\.maplibre\.reactnative\.nativeVersion=([^\r\n]+)/.exec(propsText);
    if (verMatch?.[1]) {
      androidMapLibreVer = verMatch[1].trim();
    }
    const pluginMatch = /org\.maplibre\.reactnative\.pluginVersion=([^\r\n]+)/.exec(propsText);
    if (pluginMatch?.[1]) {
      androidMapLibrePluginVer = pluginMatch[1].trim();
    }
    const turfMatch = /org\.maplibre\.reactnative\.turfVersion=([^\r\n]+)/.exec(propsText);
    if (turfMatch?.[1]) {
      androidMapLibreTurfVer = turfMatch[1].trim();
    }
    const okhttpMatch = /org\.maplibre\.reactnative\.okhttpVersion=([^\r\n]+)/.exec(propsText);
    if (okhttpMatch?.[1]) {
      androidOkHttpVer = okhttpMatch[1].trim();
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
  lines.push('native SDKs and transitive C++/JNI/JVM libraries are linked in addition to the npm packages above:');
  lines.push('');
  lines.push(`  - MapLibre Native Android SDK (org.maplibre.gl:android-sdk-opengl:${androidMapLibreVer}) : BSD-2-Clause`);
  lines.push(`  - MapLibre Android Plugins & Gestures (org.maplibre.gl:android-plugin-localization-v9, android-plugin-annotation-v9, android-plugin-markerview-v9:${androidMapLibrePluginVer}; maplibre-android-gestures:0.0.4) : BSD-2-Clause`);
  lines.push(`  - MapLibre Java Turf & GeoJSON (org.maplibre.gl:android-sdk-turf:${androidMapLibreTurfVer}, android-sdk-geojson:${androidMapLibreTurfVer}) : Apache-2.0 per the published Maven POM; MIT per the upstream repository LICENSE (both notices reproduced below)`);
  lines.push(`  - MapLibre Native iOS Distribution (maplibre-gl-native-distribution ${iosMapLibreVer}) : BSD-2-Clause`);
  lines.push('  - Glide Image Loader (com.github.bumptech.glide:glide, gifdecoder, disklrucache, annotations:4.16.0, via expo-image-loader) : BSD-2-Clause AND MIT AND Apache-2.0');
  lines.push('  - Android-Image-Cropper (com.github.CanHub:Android-Image-Cropper:4.3.1, via expo-image-picker) : Apache-2.0');
  lines.push('  - SmartLocation (io.nlopez.smartlocation:library:3.3.3, via expo-location) : MIT');
  lines.push('  - Google Play Services Location & Basement/Tasks (com.google.android.gms:play-services-location:21.0.1, play-services-base, play-services-basement, play-services-tasks, via expo-location) : Proprietary (Android Software Development Kit License / Google APIs Terms of Service; compatible with MPL-2.0 Section 3.3)');
  lines.push('  - React Native Android / iOS & Hermes Runtime (com.facebook.react:react-android, hermes-android; Yoga) : MIT');
  lines.push('  - Fresco Image Pipeline (com.facebook.fresco:fresco, fbcore, imagepipeline-*:3.2.0) : MIT');
  lines.push('  - Bolts-Tasks (com.parse.bolts:bolts-tasks:1.4.0, via Fresco) : BSD-3-Clause');
  lines.push('  - React Native C++ / JNI Support Libraries:');
  lines.push('      * fbjni (com.facebook.fbjni:fbjni:0.6.0), SoLoader (com.facebook.soloader:soloader:0.12.1), RCT-Folly : Apache-2.0');
  lines.push('      * SocketRocket (iOS), glog (Google Logging) & double-conversion (V8) : BSD-3-Clause');
  lines.push('      * fmt (fmtlib) : MIT');
  lines.push('      * Boost C++ Headers : BSL-1.0');
  lines.push('      * Android NDK C++ Runtime (libc++_shared.so) : Apache-2.0 WITH LLVM-exception');
  lines.push('  - Apache Commons IO (commons-io:commons-io:2.6, via expo-constants / expo-document-picker) & Apache Commons Codec (commons-codec:commons-codec:1.10, via expo-file-system) : Apache-2.0');
  lines.push('  - Kotlin Standard Library & Coroutines (org.jetbrains.kotlin:kotlin-stdlib, org.jetbrains.kotlinx:kotlinx-coroutines-*) : Apache-2.0');
  lines.push(`  - AndroidX, Gson (2.10.1), Timber (5.0.1) & OkHttp (com.squareup.okhttp3:okhttp:${androidOkHttpVer} / 4.9.2, okhttp-urlconnection:${androidOkHttpVer}, okio) : Apache-2.0 (OkHttp embeds Mozilla Public Suffix List data under MPL-2.0)`);
  lines.push('');
  lines.push('--- MapLibre Native (BSD-2-Clause) & MapLibre Android Plugins / Gestures (BSD-2-Clause) ---');
  lines.push('BSD 2-Clause License');
  lines.push('');
  lines.push('Copyright (c) 2021 MapLibre contributors');
  lines.push('Copyright (c) 2018-2021 MapTiler.com');
  lines.push('Copyright (c) 2014-2020 Mapbox');
  lines.push('Copyright (c) 2019, Mapbox (MapLibre Android Plugins)');
  lines.push('Copyright (c) 2018, Mapbox; Copyright (c) 2024, MapLibre contributors (MapLibre Android Gestures)');
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
  lines.push('--- Glide (com.github.bumptech.glide:glide:4.16.0, BSD-2-Clause / MIT / Apache-2.0) ---');
  lines.push('License for everything not in third_party and not otherwise marked:');
  lines.push('');
  lines.push('Copyright 2014 Google, Inc. All rights reserved.');
  lines.push('');
  lines.push('Redistribution and use in source and binary forms, with or without modification, are');
  lines.push('permitted provided that the following conditions are met:');
  lines.push('');
  lines.push('   1. Redistributions of source code must retain the above copyright notice, this list of');
  lines.push('      conditions and the following disclaimer.');
  lines.push('');
  lines.push('   2. Redistributions in binary form must reproduce the above copyright notice, this list');
  lines.push('      of conditions and the following disclaimer in the documentation and/or other materials');
  lines.push('      provided with the distribution.');
  lines.push('');
  lines.push('THIS SOFTWARE IS PROVIDED BY GOOGLE, INC. ``AS IS\'\' AND ANY EXPRESS OR IMPLIED');
  lines.push('WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND');
  lines.push('FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL GOOGLE, INC. OR');
  lines.push('CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR');
  lines.push('CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR');
  lines.push('SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON');
  lines.push('ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING');
  lines.push('NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF');
  lines.push('ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.');
  lines.push('');
  lines.push('Third-party components bundled in Glide:');
  lines.push('  - DiskLruCache: Copyright 2012 Jake Wharton; Copyright 2011 The Android Open Source Project (Apache-2.0)');
  lines.push('  - GifDecoder: Copyright (c) 2013 Xcellent Creations, Inc. (MIT)');
  lines.push('');
  lines.push('--- Bolts-Tasks, SocketRocket, glog & double-conversion (BSD-3-Clause) ---');
  lines.push('Copyright (c) 2013-present, Facebook, Inc. All rights reserved. (com.parse.bolts:bolts-tasks)');
  lines.push('Copyright 2012 Square Inc.; Portions Copyright (c) 2016-present, Facebook, Inc. All rights reserved. (SocketRocket, iOS)');
  lines.push('Copyright (c) 2008, Google Inc. All rights reserved. (glog)');
  lines.push('Copyright 2006-2011, the V8 project authors. All rights reserved. (double-conversion)');
  lines.push('');
  lines.push('Redistribution and use in source and binary forms, with or without modification,');
  lines.push('are permitted provided that the following conditions are met:');
  lines.push('');
  lines.push('1. Redistributions of source code must retain the above copyright notice, this');
  lines.push('   list of conditions and the following disclaimer.');
  lines.push('2. Redistributions in binary form must reproduce the above copyright notice,');
  lines.push('   this list of conditions and the following disclaimer in the documentation');
  lines.push('   and/or other materials provided with the distribution.');
  lines.push('3. Neither the name of the copyright holder nor the names of its contributors');
  lines.push('   may be used to endorse or promote products derived from this software without');
  lines.push('   specific prior written permission.');
  lines.push('');
  lines.push('THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND');
  lines.push('ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED');
  lines.push('WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE');
  lines.push('DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR');
  lines.push('ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES');
  lines.push('(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;');
  lines.push('LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON');
  lines.push('ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT');
  lines.push('(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS');
  lines.push('SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.');
  lines.push('');
  lines.push('--- Android-Image-Cropper, MapLibre Java Turf, OkHttp, Commons, Meta JNI & AndroidX (Apache-2.0) ---');
  lines.push('Copyright (c) 2020-2024 CanHub / Arthur Teplitzki (Android-Image-Cropper)');
  lines.push('Copyright (c) MapLibre contributors / Mapbox (MapLibre Java Turf & GeoJSON, as declared in the Maven POM)');
  lines.push('Copyright (c) Square, Inc. (OkHttp, Okio) / Jake Wharton (Timber)');
  lines.push('Copyright (c) Google Inc. (Gson) / JetBrains s.r.o. (Kotlin Standard Library & Coroutines)');
  lines.push('Copyright (c) Meta Platforms, Inc. and affiliates. (fbjni, SoLoader, RCT-Folly)');
  lines.push('Copyright (c) The Android Open Source Project (AndroidX)');
  lines.push('Copyright (c) The LLVM Project (libc++_shared, Apache-2.0 WITH LLVM-exception)');
  lines.push('');
  lines.push('Licensed under the Apache License, Version 2.0 (the "License");');
  lines.push('you may not use these files except in compliance with the License.');
  lines.push('You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0');
  lines.push('Unless required by applicable law or agreed to in writing, software distributed under the');
  lines.push('License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.');
  lines.push('');
  lines.push('[NOTICE — Apache Commons IO 2.6 (commons-io:commons-io:2.6)]');
  lines.push('Apache Commons IO');
  lines.push('Copyright 2002-2017 The Apache Software Foundation');
  lines.push('This product includes software developed at The Apache Software Foundation (http://www.apache.org/).');
  lines.push('');
  lines.push('[NOTICE — Apache Commons Codec 1.10 (commons-codec:commons-codec:1.10)]');
  lines.push('Apache Commons Codec');
  lines.push('Copyright 2002-2014 The Apache Software Foundation');
  lines.push('This product includes software developed at The Apache Software Foundation (http://www.apache.org/).');
  lines.push('src/test/org/apache/commons/codec/language/DoubleMetaphoneTest.java contains test data from');
  lines.push('http://aspell.net/test/orig/batch0.tab — Copyright (C) 2002 Kevin Atkinson (kevina@gnu.org).');
  lines.push('The content of package org.apache.commons.codec.language.bm has been translated from the');
  lines.push('original php source code available at http://stevemorse.org/phoneticinfo.htm with permission');
  lines.push('from the original authors. Original source copyright: Copyright (c) 2008 Alexander Beider & Stephen P. Morse.');
  lines.push('');
  lines.push('[NOTICE — OkHttp Embedded Public Suffix List (okhttp3/internal/publicsuffix/NOTICE)]');
  lines.push('Note that publicsuffixes.gz is compiled from The Public Suffix List:');
  lines.push('https://publicsuffix.org/list/public_suffix_list.dat');
  lines.push('It is subject to the terms of the Mozilla Public License, v. 2.0: https://mozilla.org/MPL/2.0/');
  lines.push('');
  lines.push('--- SmartLocation, MapLibre Java Turf / GeoJSON, Yoga, React Native / Hermes & fmt (MIT) ---');
  lines.push('Copyright (c) 2013-2017 Nacho Lopez (mrmans0n) (io.nlopez.smartlocation)');
  lines.push('Copyright (c) 2018 Mapbox (MapLibre Java Turf & GeoJSON, upstream repository LICENSE)');
  lines.push('Copyright (c) Meta Platforms, Inc. and affiliates. (React Native, Hermes, Yoga)');
  lines.push('Copyright (c) 2012 - present, Victor Zverovich and {fmt} contributors (fmt)');
  lines.push('');
  lines.push('Permission is hereby granted, free of charge, to any person obtaining a copy of this');
  lines.push('software and associated documentation files (the "Software"), to deal in the Software');
  lines.push('without restriction, including without limitation the rights to use, copy, modify, merge,');
  lines.push('publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons');
  lines.push('to whom the Software is furnished to do so, subject to the following conditions:');
  lines.push('');
  lines.push('The above copyright notice and this permission notice shall be included in all copies or');
  lines.push('substantial portions of the Software.');
  lines.push('');
  lines.push('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,');
  lines.push('INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR');
  lines.push('PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE');
  lines.push('FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR');
  lines.push('OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER');
  lines.push('DEALINGS IN THE SOFTWARE.');
  lines.push('');
  lines.push('--- Boost C++ Libraries (BSL-1.0, React Native C++ headers) ---');
  lines.push('Boost Software License - Version 1.0 - August 17th, 2003');
  lines.push('Permission is hereby granted, free of charge, to any person or organization obtaining a copy');
  lines.push('of the software and accompanying documentation covered by this license (the "Software") to use,');
  lines.push('reproduce, display, distribute, execute, and transmit the Software, and to prepare derivative');
  lines.push('works of the Software, and to permit third-parties to whom the Software is furnished to do so.');
  lines.push('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.');
  lines.push('');
  lines.push('--- Google Play Services Location (com.google.android.gms:play-services-location) ---');
  lines.push('Copyright (c) Google LLC. Distributed under the Android Software Development Kit License');
  lines.push('Agreement / Google APIs Terms of Service (https://developers.google.com/terms).');
  lines.push('Linked solely into the MPL-2.0 Android client package via expo-location (MPL-2.0 § 3.3);');
  lines.push('includes third-party open-source components documented in the AAR res/raw/third_party_licenses');
  lines.push('(Apache-2.0 / BSD / MIT / ICU / UTF-8 / JSR-305 / Protobuf).');
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
  lines.push('  - OpenStreetMap Map Data & Nominatim Geocoding : ODbL-1.0 (© OpenStreetMap contributors, https://www.openstreetmap.org/copyright)');
  lines.push('  - OpenMapTiles Vector Tile Schema & Styles (incl. OSM Liberty / CARTO Dark Matter, modified in dark mode) : CC BY 4.0 / BSD-3-Clause / MIT (https://openmaptiles.org/, https://carto.com/attributions)');
  lines.push('  - Natural Earth Low-Zoom Shaded Relief (via OpenFreeMap styles) : Public Domain (https://www.naturalearthdata.com/)');
  lines.push('  - Noto Sans Map Label Font Glyphs (via OpenFreeMap styles) : SIL OFL 1.1 (https://openfontlicense.org/)');
  lines.push('  - OpenFreeMap Hosting & Tooling (Hyperknot Software Kft., Hungary) : MIT (https://openfreemap.org/)');
  lines.push('  - German Municipality Boundaries (BKG VG250) : dl-de/by-2-0');
  lines.push('      Attribution: © BKG (<year of last data retrieval>) dl-de/by-2-0 (https://www.govdata.de/dl-de/by-2-0),');
  lines.push('      Datenquellen: https://sg.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf (Daten verändert)');
  lines.push('  - Built-in German State Aerial Orthophotos (DOP20 / DOP10; Daten bearbeitet / Daten verändert).');
  lines.push('    Source notes follow each WMS GetCapabilities or, where the service states no license (SL, SN, ST, MV),');
  lines.push('    the state metadata catalogue / published terms of use:');
  lines.push('      * RP  (Rheinland-Pfalz)        : dl-de/by-2-0   | ©GeoBasis-DE / LVermGeoRP (<Jahr>), dl-de/by-2-0, http://www.lvermgeo.rlp.de [Daten bearbeitet]');
  lines.push('      * HE  (Hessen)                 : dl-de/zero-2-0 | © Hessische Verwaltung für Bodenmanagement und Geoinformation (HVBG) (<Jahr>)');
  lines.push('      * NW  (Nordrhein-Westfalen)    : dl-de/zero-2-0 | © Land NRW (Geobasis NRW) (<Jahr>)');
  lines.push('      * BW  (Baden-Württemberg)      : dl-de/by-2-0   | LGL-BW (<Jahr>) Datenlizenz Deutschland - Namensnennung - Version 2.0, www.lgl-bw.de');
  lines.push('      * BY  (Bayern)                 : CC BY 4.0      | Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (<Jahr>)');
  lines.push('      * SL  (Saarland)               : dl-de/by-2-0   | © GeoBasis DE/LVGL-SL (<Jahr>)');
  lines.push('      * BE/BB (Berlin / Brandenburg) : dl-de/by-2-0   | © GeoBasis-DE / LGB (<Jahr>), dl-de/by-2-0; © Geoportal Berlin (<Jahr>), dl-de/zero-2-0');
  lines.push('                                       (Berlin publishes its own orthophotos under dl-de/zero-2-0; the Berlin credit is kept voluntarily)');
  lines.push('      * HH  (Hamburg, TIME=2026)     : dl-de/by-2-0   | © Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV) (<Jahr>)');
  lines.push('                                       (pinned to LGV OpenData aerial vintage TIME=2026; excludes 2023 Maxar satellite vintage)');
  lines.push('      * NI  (Niedersachsen)          : CC BY 4.0      | LGLN (<Jahr>) Creative Commons Namensnennung – 4.0 International (CC BY 4.0)');
  lines.push('      * HB  (Bremen / Bremerhaven)   : CC BY 4.0      | © Landesamt GeoInformation Bremen (<Jahr>)');
  lines.push('      * SH  (Schleswig-Holstein)     : CC BY 4.0      | © GeoBasis-DE/LVermGeo SH/CC BY 4.0 (<Jahr>)');
  lines.push('      * MV  (Mecklenburg-Vorpommern) : CC BY 4.0      | © GeoBasis-DE/M-V <Jahr> (https://www.laiv-mv.de)');
  lines.push('      * SN  (Sachsen)                : dl-de/by-2-0   | Quelle: GeoSN, dl-de/by-2-0 (<Jahr>)');
  lines.push('      * ST  (Sachsen-Anhalt)         : dl-de/by-2-0   | © GeoBasis-DE / LVermGeo ST (<Jahr>)');
  lines.push('      * TH  (Thüringen)              : CC BY 4.0      | © GDI-Th (<Jahr>)');
  lines.push('      License URLs:');
  lines.push('        - dl-de/by-2-0   : https://www.govdata.de/dl-de/by-2-0');
  lines.push('        - dl-de/zero-2-0 : https://www.govdata.de/dl-de/zero-2-0');
  lines.push('        - CC BY 4.0      : https://creativecommons.org/licenses/by/4.0/');
  lines.push('  - User-Contributed & Exported Platform Content:');
  lines.push('      * Compiled Polygon Dataset Export (/api/v1/polygons/export.geojson) : ODbL-1.0 (https://opendatacommons.org/licenses/odbl/1-0/)');
  lines.push('        concurrently subject to applicable upstream CC BY 4.0 (incl. §§ 2(a)(5)(B) & 3(b) no-DRM; ODbL-1.0 § 4.7(b) parallel-DRM');
  lines.push('        does not override upstream CC BY 4.0) and dl-de/by-2-0 attribution obligations on German State DOP20/DOP10 and BKG VG250');
  lines.push('        municipality attributes (?includeMunicipality=false omits VG250 attributes; OSM-specific agency waivers apply solely to OSM).');
  lines.push('      * Contributor Rights Waiver on Own Polygon Input & Notes            : CC0-1.0 + Section 3 Public License Fallback (https://creativecommons.org/publicdomain/zero/1.0/)');
  lines.push('      * Admin Bulk Imports (.geojson / .gpkg)                             : Mandatory explicit license declaration: CC0-1.0 / PDDL-1.0 / dl-de/zero-2-0 /');
  lines.push('        Public Domain / attributed ODbL-1.0, or waiver-confirmed CC BY 4.0 / dl-de/by-2-0 with persisted attribution.');
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
    if (name.startsWith('@openunseal/')) {
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
