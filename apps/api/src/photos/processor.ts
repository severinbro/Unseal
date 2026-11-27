// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 OpenUnseal Contributors

import exifr from 'exifr';
import sharp from 'sharp';

import { ApiError, PHOTO_LIMITS } from '@openunseal/shared';

export interface ProcessedPhotoBuffers {
  fullWebp: Buffer;
  thumbWebp: Buffer;
  width: number;
  height: number;
  exifGps: { lat: number; lng: number } | null;
}

const ALLOWED_SHARP_FORMATS = new Set([
  'jpeg',
  'png',
  'webp',
  'heif',
  'avif',
  'tiff',
]);

const MAX_INPUT_PIXELS = 64_000_000;

export async function processUploadedPhoto(
  buffer: Buffer,
): Promise<ProcessedPhotoBuffers> {
  if (buffer.byteLength === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Uploaded photo file is empty.');
  }
  if (buffer.byteLength > PHOTO_LIMITS.MAX_UPLOAD_BYTES) {
    throw new ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      `Photo exceeds maximum size of ${Math.round(PHOTO_LIMITS.MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    );
  }

  let exifGps: { lat: number; lng: number } | null = null;
  try {
    const gps = await exifr.gps(buffer);
    if (
      gps &&
      typeof gps.latitude === 'number' &&
      typeof gps.longitude === 'number' &&
      Number.isFinite(gps.latitude) &&
      Number.isFinite(gps.longitude) &&
      Math.abs(gps.latitude) <= 90 &&
      Math.abs(gps.longitude) <= 180
    ) {
      exifGps = {
        lat: gps.latitude,
        lng: gps.longitude,
      };
    }
  } catch {
    exifGps = null;
  }

  let format: string | undefined;
  try {
    const meta = await sharp(buffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
    format = meta.format;
  } catch {
    throw new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Uploaded file is not a valid supported image.',
    );
  }

  if (!format || !ALLOWED_SHARP_FORMATS.has(format)) {
    throw new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      `Unsupported image format "${format ?? 'unknown'}". Allowed formats: JPEG, PNG, WebP, AVIF.`,
    );
  }

  try {
    // .rotate() applies EXIF orientation to pixel buffer; omitting .withMetadata() strips all EXIF/GPS/IPTC tags
    const fullResult = await sharp(buffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .resize({
        width: PHOTO_LIMITS.MAX_DIMENSION_PX,
        height: PHOTO_LIMITS.MAX_DIMENSION_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    const thumbWebp = await sharp(buffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .resize({
        width: PHOTO_LIMITS.THUMB_DIMENSION_PX,
        height: PHOTO_LIMITS.THUMB_DIMENSION_PX,
        fit: 'cover',
      })
      .webp({ quality: 76 })
      .toBuffer();

    return {
      fullWebp: fullResult.data,
      thumbWebp,
      width: fullResult.info.width,
      height: fullResult.info.height,
      exifGps,
    };
  } catch {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Failed to decode and sanitize uploaded image.',
    );
  }
}
