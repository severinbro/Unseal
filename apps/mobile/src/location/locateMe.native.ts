import * as Location from 'expo-location';

import {
  DEFAULT_LOCALE,
  getTranslations,
  type Locale,
} from '../i18n/translations';
import type { LocateMeResult } from './locateMe.types';

export type { LocateMeResult } from './locateMe.types';

function isValidCoordinatePair(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90
  );
}

export async function requestCurrentCoordinates(
  _nav?: unknown,
  _isSecureContext?: boolean,
  locale: Locale = DEFAULT_LOCALE,
  _refinementWindowMs?: number,
): Promise<LocateMeResult> {
  const t = getTranslations(locale).location;
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      const reason =
        permission.canAskAgain === false
          ? t.nativePermissionDeniedSettings
          : t.nativePermissionDeniedPrompt;
      return {
        ok: false,
        reason,
      };
    }

    let position: Location.LocationObject;
    try {
      position = await Location.getCurrentPositionAsync({
        accuracy: Location.LocationAccuracy.High,
      });
    } catch {
      position = await Location.getCurrentPositionAsync({
        accuracy: Location.LocationAccuracy.Balanced,
      });
    }
    const { longitude, latitude, accuracy } = position.coords;

    if (!isValidCoordinatePair(longitude, latitude)) {
      return {
        ok: false,
        reason: t.nativeInvalidCoords,
      };
    }

    return {
      ok: true,
      lng: longitude,
      lat: latitude,
      ...(typeof accuracy === 'number' &&
      Number.isFinite(accuracy) &&
      accuracy >= 0
        ? { accuracyMeters: accuracy }
        : {}),
    };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message.trim() : '';
    const suffix = detail.length > 0 ? ` (${detail})` : '';
    return {
      ok: false,
      reason: t.nativeGenericError(suffix),
    };
  }
}
