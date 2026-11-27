// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

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

interface FileInputOptions {
  accept: string;
  multiple?: boolean;
  /** Opens the rear camera directly on phones (`capture="environment"`). */
  capture?: boolean;
}

/**
 * Opens the browser's file dialog through a hidden `<input type="file">` and
 * resolves with the chosen files, or an empty list when the dialog is closed.
 */
function openFileInput(options: FileInputOptions): Promise<File[]> {
  const doc = (globalThis as { document?: Document }).document;
  if (doc === undefined) {
    return Promise.reject(new Error('File selection needs a browser.'));
  }
  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = options.accept;
  input.multiple = options.multiple === true;
  if (options.capture === true) {
    input.setAttribute('capture', 'environment');
  }
  input.style.display = 'none';
  doc.body.appendChild(input);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      const files = input.files ? Array.from(input.files) : [];
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', finish);
    input.addEventListener('cancel', finish);
    input.click();
  });
}

function inferImageFilename(file: File, mimeType: string, index: number): string {
  if (file.name.trim().length > 0) {
    return file.name.trim();
  }
  const suffix = index > 0 ? `-${index + 1}` : '';
  const ext =
    mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `site-photo-${Date.now()}${suffix}.${ext}`;
}

function toPickedImage(file: File, index = 0): PickedImageSelection {
  const mimeType = file.type.trim().length > 0 ? file.type : 'image/jpeg';
  const previewUri = URL.createObjectURL(file);
  return {
    previewUri,
    file: {
      uri: previewUri,
      name: inferImageFilename(file, mimeType, index),
      mimeType,
      webFile: file,
    },
  };
}

function errorMessage(locale: Locale, de: string, en: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : '';
  const base = locale === 'de' ? de : en;
  return `${base}${detail ? `: ${detail}` : '.'}`;
}

export async function pickPhotoFromCamera(
  locale: Locale,
): Promise<PickerOutcome<PickedImageSelection>> {
  try {
    const [file] = await openFileInput({ accept: 'image/*', capture: true });
    return file === undefined
      ? { status: 'canceled' }
      : { status: 'picked', value: toPickedImage(file) };
  } catch (err: unknown) {
    return {
      status: 'error',
      message: errorMessage(locale, 'Kamera konnte nicht geöffnet werden', 'Unable to open camera', err),
    };
  }
}

export async function pickPhotosFromLibrary(
  locale: Locale,
  options?: { selectionLimit?: number },
): Promise<PickerOutcome<PickedImageSelection[]>> {
  try {
    const files = await openFileInput({ accept: 'image/*', multiple: true });
    if (files.length === 0) {
      return { status: 'canceled' };
    }
    const limit =
      options?.selectionLimit !== undefined && options.selectionLimit > 0
        ? Math.trunc(options.selectionLimit)
        : files.length;
    return {
      status: 'picked',
      value: files.slice(0, limit).map((file, index) => toPickedImage(file, index)),
    };
  } catch (err: unknown) {
    return {
      status: 'error',
      message: errorMessage(locale, 'Fotoauswahl fehlgeschlagen', 'Photo selection failed', err),
    };
  }
}

export async function pickGeoImportDocument(
  locale: Locale,
): Promise<PickerOutcome<UploadableFileInput>> {
  try {
    const [file] = await openFileInput({ accept: '.geojson,.json,.gpkg' });
    if (file === undefined) {
      return { status: 'canceled' };
    }
    const name = file.name.trim();
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
    return {
      status: 'picked',
      value: {
        name,
        mimeType: lower.endsWith('.gpkg')
          ? 'application/geopackage+sqlite3'
          : 'application/geo+json',
        webFile: file,
      },
    };
  } catch (err: unknown) {
    return {
      status: 'error',
      message: errorMessage(locale, 'Dateiauswahl fehlgeschlagen', 'Document selection failed', err),
    };
  }
}
