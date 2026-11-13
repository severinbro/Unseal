import {
  DEFAULT_LOCALE,
  getTranslations,
  type Locale,
} from '../i18n/translations';
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

function mapGeolocationError(
  error: GeolocationPositionErrorLike,
  locale: Locale,
): string {
  const t = getTranslations(locale).location;
  switch (error.code) {
    case 1:
      return t.webPermissionDenied;
    case 2:
      return t.webPositionUnavailable;
    case 3:
      return t.webTimeout;
    default: {
      const detail = error.message?.trim() ?? '';
      return t.webGenericError(detail);
    }
  }
}

export async function requestCurrentCoordinates(
  nav?: WebNavigatorLike | null,
  isSecureContext?: boolean,
  locale: Locale = DEFAULT_LOCALE,
): Promise<LocateMeResult> {
  const t = getTranslations(locale).location;
  const secure = isSecureContext ?? resolveDefaultIsSecureContext();
  if (!secure) {
    return {
      ok: false,
      reason: t.webHttpsRequired,
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
      reason: t.webUnsupported,
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
              reason: t.webInvalidCoords,
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
            reason: mapGeolocationError(error, locale),
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
        reason: t.webRequestFailed(detail),
      });
    }
  });
}
