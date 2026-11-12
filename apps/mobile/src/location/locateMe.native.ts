import * as Location from 'expo-location';

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

export async function requestCurrentCoordinates(): Promise<LocateMeResult> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      const reason =
        permission.canAskAgain === false
          ? 'Location permission was denied. Enable foreground location access for Entsiegelungskartierung in your device settings to center the map on your GPS position.'
          : 'Location permission was denied. Grant foreground location access to center the map on your current GPS position.';
      return {
        ok: false,
        reason,
      };
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.LocationAccuracy.Balanced,
    });
    const { longitude, latitude } = position.coords;

    if (!isValidCoordinatePair(longitude, latitude)) {
      return {
        ok: false,
        reason: 'Device location provider returned invalid GPS coordinates.',
      };
    }

    return {
      ok: true,
      lng: longitude,
      lat: latitude,
    };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message.trim() : '';
    const suffix = detail.length > 0 ? ` (${detail})` : '';
    return {
      ok: false,
      reason: `Unable to determine your current GPS position. Ensure device location services are enabled and try again.${suffix}`,
    };
  }
}
