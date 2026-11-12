import type { LocateMeResult } from './locateMe.types';

export type { LocateMeResult } from './locateMe.types';

export interface GeolocationCoordinatesLike {
  readonly longitude: number;
  readonly latitude: number;
}

export interface GeolocationPositionLike {
  readonly coords: GeolocationCoordinatesLike;
}

export interface GeolocationPositionErrorLike {
  readonly code: number;
  readonly message?: string;
}

export interface GeolocationPositionOptionsLike {
  readonly enableHighAccuracy?: boolean;
  readonly timeout?: number;
  readonly maximumAge?: number;
}

export interface GeolocationLike {
  getCurrentPosition(
    successCallback: (position: GeolocationPositionLike) => void,
    errorCallback?: (error: GeolocationPositionErrorLike) => void,
    options?: GeolocationPositionOptionsLike,
  ): void;
}

export interface WebNavigatorLike {
  readonly geolocation?: GeolocationLike | null;
}

const GEOLOCATION_OPTIONS: GeolocationPositionOptionsLike = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 30_000,
};

function resolveDefaultIsSecureContext(): boolean {
  const scope = globalThis as {
    isSecureContext?: unknown;
    window?: {
      isSecureContext?: unknown;
      location?: { protocol?: string; hostname?: string };
    };
  };

  if (typeof scope.isSecureContext === 'boolean') {
    return scope.isSecureContext;
  }
  if (typeof scope.window?.isSecureContext === 'boolean') {
    return scope.window.isSecureContext;
  }
  if (scope.window?.location) {
    const { protocol, hostname } = scope.window.location;
    return (
      protocol === 'https:' ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]'
    );
  }
  return true;
}

function resolveDefaultNavigator(): WebNavigatorLike | null {
  const scope = globalThis as { navigator?: WebNavigatorLike | null };
  return scope.navigator ?? null;
}

function isValidCoordinatePair(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90
  );
}

function mapGeolocationError(error: GeolocationPositionErrorLike): string {
  switch (error.code) {
    case 1:
      return 'Location permission was denied. Allow location access in your browser site permissions (and ensure HTTPS) to center the map on your position.';
    case 2:
      return 'Your current position is unavailable. Check that device location services are enabled and try again.';
    case 3:
      return 'Timed out while waiting for GPS coordinates. Move to an area with a clearer view or try again.';
    default: {
      const detail = error.message?.trim() ?? '';
      return detail.length > 0
        ? `Unable to retrieve your current location: ${detail}`
        : 'Unable to retrieve your current location.';
    }
  }
}

export async function requestCurrentCoordinates(
  nav?: WebNavigatorLike | null,
  isSecureContext?: boolean,
): Promise<LocateMeResult> {
  const secure = isSecureContext ?? resolveDefaultIsSecureContext();
  if (!secure) {
    return {
      ok: false,
      reason:
        'Browser geolocation requires a secure HTTPS connection (or localhost). Open Entsiegelungskartierung over https:// to use "Locate me".',
    };
  }

  const resolvedNav = nav === undefined ? resolveDefaultNavigator() : nav;
  if (
    !resolvedNav ||
    !resolvedNav.geolocation ||
    typeof resolvedNav.geolocation.getCurrentPosition !== 'function'
  ) {
    return {
      ok: false,
      reason: 'Geolocation is not supported or available in this browser.',
    };
  }

  const geolocation = resolvedNav.geolocation;

  return new Promise<LocateMeResult>((resolve) => {
    let settled = false;
    const finish = (result: LocateMeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    try {
      geolocation.getCurrentPosition(
        (position) => {
          const lng = position.coords.longitude;
          const lat = position.coords.latitude;
          if (!isValidCoordinatePair(lng, lat)) {
            finish({
              ok: false,
              reason:
                'Browser geolocation returned invalid GPS coordinates.',
            });
            return;
          }
          finish({
            ok: true,
            lng,
            lat,
          });
        },
        (error) => {
          finish({
            ok: false,
            reason: mapGeolocationError(error),
          });
        },
        GEOLOCATION_OPTIONS,
      );
    } catch (err: unknown) {
      const detail =
        err instanceof Error && err.message.trim().length > 0
          ? `: ${err.message.trim()}`
          : '.';
      finish({
        ok: false,
        reason: `Unable to request browser geolocation${detail}`,
      });
    }
  });
}
