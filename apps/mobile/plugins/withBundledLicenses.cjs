// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

/**
 * Copies the verbatim MPL-2.0 client license and complete third-party notices
 * into native Android/iOS application asset directories during `npx expo prebuild`
 * so standalone `.apk` / `.ipa` packages always carry required offline license texts
 * (MPL-2.0 § 3.2, BSD-2-Clause, BSD-3-Clause, MIT, Apache-2.0, ISC).
 */
function copyBundledLicensesToNativeDir(projectRoot, targetDir) {
  const clientLicenseSrc = path.resolve(projectRoot, 'LICENSE');
  const thirdPartyNoticesSrc = path.resolve(
    projectRoot,
    '..',
    '..',
    'THIRD_PARTY_NOTICES.txt',
  );

  fs.mkdirSync(targetDir, { recursive: true });

  const copiedFiles = [];
  if (fs.existsSync(clientLicenseSrc)) {
    const dest = path.join(targetDir, 'LICENSE-MPL-2.0.txt');
    fs.copyFileSync(clientLicenseSrc, dest);
    copiedFiles.push(dest);
  }
  if (fs.existsSync(thirdPartyNoticesSrc)) {
    const dest = path.join(targetDir, 'THIRD_PARTY_NOTICES.txt');
    fs.copyFileSync(thirdPartyNoticesSrc, dest);
    copiedFiles.push(dest);
  }
  return copiedFiles;
}

function withBundledLicenses(config) {
  let nextConfig = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const assetsDir = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'assets',
      );
      copyBundledLicensesToNativeDir(
        modConfig.modRequest.projectRoot,
        assetsDir,
      );
      return modConfig;
    },
  ]);

  nextConfig = withDangerousMod(nextConfig, [
    'ios',
    async (modConfig) => {
      const iosDir = path.join(
        modConfig.modRequest.platformProjectRoot,
        'BundledLicenses',
      );
      copyBundledLicensesToNativeDir(modConfig.modRequest.projectRoot, iosDir);
      return modConfig;
    },
  ]);

  return nextConfig;
}

withBundledLicenses.copyBundledLicensesToNativeDir =
  copyBundledLicensesToNativeDir;

module.exports = withBundledLicenses;
