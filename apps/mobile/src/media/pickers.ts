// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { UploadableFileInput } from '../api/client';
import type { Locale } from '../i18n/translations';

export interface PickedImageSelection {
  previewUri: string;
  file: UploadableFileInput;
}

export type PickerOutcome<T> =
  | { status: 'picked'; value: T }
  | { status: 'canceled' }
  | { status: 'error'; message: string };

async function resolveWebBlobIfNeeded(
  uri: string,
  nativeWebFile: Blob | undefined,
  mimeType: string,
): Promise<Blob | undefined> {
  if (Platform.OS !== 'web') {
    return undefined;
  }
  if (nativeWebFile instanceof Blob) {
    return nativeWebFile;
  }
  const response = await fetch(uri);
  const blob = await response.blob();
  if (blob.type && blob.type.length > 0) {
    return blob;
  }
  return new Blob([blob], { type: mimeType });
}

function inferImageFilename(
  rawName: string | null | undefined,
  mimeType: string,
  index = 0,
): string {
  if (rawName && rawName.trim().length > 0) {
    return rawName.trim();
  }
  const suffix = index > 0 ? `-${index + 1}` : '';
  if (mimeType === 'image/png') {
    return `site-photo-${Date.now()}${suffix}.png`;
  }
  if (mimeType === 'image/webp') {
    return `site-photo-${Date.now()}${suffix}.webp`;
  }
  return `site-photo-${Date.now()}${suffix}.jpg`;
}

async function assetToPickedImage(
  asset: ImagePicker.ImagePickerAsset,
  index = 0,
): Promise<PickedImageSelection> {
  const mimeType =
    asset.mimeType && asset.mimeType.trim().length > 0
      ? asset.mimeType.trim()
      : 'image/jpeg';
  const name = inferImageFilename(asset.fileName, mimeType, index);
  const maybeWebFile = (asset as { file?: Blob | undefined }).file;
  const webFile = await resolveWebBlobIfNeeded(
    asset.uri,
    maybeWebFile,
    mimeType,
  );

  return {
    previewUri: asset.uri,
    file: {
      uri: asset.uri,
      name,
      mimeType,
      ...(webFile !== undefined ? { webFile } : {}),
    },
  };
}

export async function pickPhotoFromCamera(
  locale: Locale,
): Promise<PickerOutcome<PickedImageSelection>> {
  try {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        return {
          status: 'error',
          message:
            locale === 'de'
              ? 'Kameraberechtigung verweigert. Bitte erlaube den Kamerazugriff in den Geräteeinstellungen.'
              : 'Camera permission denied. Please enable camera access in device settings.',
        };
      }
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.92,
      exif: true,
    });

    if (result.canceled || !result.assets[0]) {
      return { status: 'canceled' };
    }

    const picked = await assetToPickedImage(result.assets[0]);
    return { status: 'picked', value: picked };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : '';
    return {
      status: 'error',
      message:
        locale === 'de'
          ? `Kamera konnte nicht geöffnet werden${detail ? `: ${detail}` : '.'}`
          : `Unable to open camera${detail ? `: ${detail}` : '.'}`,
    };
  }
}

export async function pickPhotosFromLibrary(
  locale: Locale,
  options?: { selectionLimit?: number },
): Promise<PickerOutcome<PickedImageSelection[]>> {
  try {
    if (Platform.OS !== 'web') {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        return {
          status: 'error',
          message:
            locale === 'de'
              ? 'Fotomediathek-Berechtigung verweigert.'
              : 'Photo library permission denied.',
        };
      }
    }

    const selectionLimit =
      options?.selectionLimit !== undefined && options.selectionLimit > 0
        ? Math.trunc(options.selectionLimit)
        : undefined;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.92,
      exif: true,
      allowsMultipleSelection: true,
      ...(selectionLimit !== undefined ? { selectionLimit } : {}),
    });

    if (result.canceled || result.assets.length === 0) {
      return { status: 'canceled' };
    }

    const selectedAssets =
      selectionLimit !== undefined
        ? result.assets.slice(0, selectionLimit)
        : result.assets;

    const picked = await Promise.all(
      selectedAssets.map((asset, index) => assetToPickedImage(asset, index)),
    );
    return { status: 'picked', value: picked };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : '';
    return {
      status: 'error',
      message:
        locale === 'de'
          ? `Fotoauswahl fehlgeschlagen${detail ? `: ${detail}` : '.'}`
          : `Photo selection failed${detail ? `: ${detail}` : '.'}`,
    };
  }
}

export async function pickPhotoFromLibrary(
  locale: Locale,
): Promise<PickerOutcome<PickedImageSelection>> {
  try {
    if (Platform.OS !== 'web') {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        return {
          status: 'error',
          message:
            locale === 'de'
              ? 'Fotomediathek-Berechtigung verweigert.'
              : 'Photo library permission denied.',
        };
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.92,
      exif: true,
    });

    if (result.canceled || !result.assets[0]) {
      return { status: 'canceled' };
    }

    const picked = await assetToPickedImage(result.assets[0]);
    return { status: 'picked', value: picked };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : '';
    return {
      status: 'error',
      message:
        locale === 'de'
          ? `Fotoauswahl fehlgeschlagen${detail ? `: ${detail}` : '.'}`
          : `Photo selection failed${detail ? `: ${detail}` : '.'}`,
    };
  }
}

export async function pickGeoImportDocument(
  locale: Locale,
): Promise<PickerOutcome<UploadableFileInput>> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled || !result.assets[0]) {
      return { status: 'canceled' };
    }

    const asset = result.assets[0];
    const name = asset.name.trim();
    const lower = name.toLowerCase();
    if (
      !lower.endsWith('.geojson') &&
      !lower.endsWith('.json') &&
      !lower.endsWith('.gpkg')
    ) {
      return {
        status: 'error',
        message:
          locale === 'de'
            ? 'Bitte wähle eine .geojson-, .json- oder .gpkg-Datei aus.'
            : 'Please select a .geojson, .json, or .gpkg file.',
      };
    }

    const mimeType = lower.endsWith('.gpkg')
      ? 'application/geopackage+sqlite3'
      : 'application/geo+json';
    const maybeWebFile = (asset as { file?: Blob | undefined }).file;
    const webFile = await resolveWebBlobIfNeeded(
      asset.uri,
      maybeWebFile,
      mimeType,
    );

    return {
      status: 'picked',
      value: {
        uri: asset.uri,
        name,
        mimeType,
        ...(webFile !== undefined ? { webFile } : {}),
      },
    };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : '';
    return {
      status: 'error',
      message:
        locale === 'de'
          ? `Dateiauswahl fehlgeschlagen${detail ? `: ${detail}` : '.'}`
          : `Document selection failed${detail ? `: ${detail}` : '.'}`,
    };
  }
}
