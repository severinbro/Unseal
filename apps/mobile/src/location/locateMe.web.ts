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
  readonly accuracy?: number | null;
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
  watchPosition?(
    successCallback: (position: GeolocationPositionLike) => void,
    errorCallback?: (error: GeolocationPositionErrorLike) => void,
    options?: GeolocationPositionOptionsLike,
  ): number;
  clearWatch?(watchId: number): void;
}

export interface WebNavigatorLike {
  readonly geolocation?: GeolocationLike | null;
}

const HIGH_ACCURACY_GEOLOCATION_OPTIONS: GeolocationPositionOptionsLike = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0,
};

const FALLBACK_GEOLOCATION_OPTIONS: GeolocationPositionOptionsLike = {
  enableHighAccuracy: false,
  timeout: 8_000,
  maximumAge: 0,
};

/**
 * Threshold in meters for accepting a browser geolocation reading immediately
 * without waiting for further GNSS / Wi-Fi refinement. Coarse ISP/GeoIP fixes
 * (typically 3,000–50,000 m, e.g. regional backbone hubs) exceed this and wait
 * briefly for hardware GPS or Wi-Fi triangulation to lock onto the user.
 */
export const PRECISE_ACCURACY_THRESHOLD_M = 150;
export const COARSE_REFINEMENT_WINDOW_MS = 4_500;

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

function normalizeAccuracyMeters(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
    ? raw
    : undefined;
}

function buildSuccessResult(
  lng: number,
  lat: number,
  accuracyMeters: number | undefined,
): Extract<LocateMeResult, { ok: true }> {
  return accuracyMeters !== undefined
    ? { ok: true, lng, lat, accuracyMeters }
    : { ok: true, lng, lat };
}

export async function requestCurrentCoordinates(
  nav?: WebNavigatorLike | null,
  isSecureContext?: boolean,
  locale: Locale = DEFAULT_LOCALE,
  refinementWindowMs: number = COARSE_REFINEMENT_WINDOW_MS,
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
  const canWatch =
    typeof geolocation.watchPosition === 'function' &&
    typeof geolocation.clearWatch === 'function';

  return new Promise<LocateMeResult>((resolve) => {
    let settled = false;
    let watchId: number | null = null;
    let watchCleared = false;
    let refinementTimer: ReturnType<typeof setTimeout> | null = null;
    let bestFix: Extract<LocateMeResult, { ok: true }> | null = null;

    const cleanupWatch = (): void => {
      if (refinementTimer !== null) {
        clearTimeout(refinementTimer);
        refinementTimer = null;
      }
      if (!watchCleared && watchId !== null && typeof geolocation.clearWatch === 'function') {
        watchCleared = true;
        try {
          geolocation.clearWatch(watchId);
        } catch {
          // Ignore clearWatch errors during teardown.
        }
      }
    };

    const finish = (result: LocateMeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupWatch();
      resolve(result);
    };

    const tryLowAccuracyFallback = (primaryError: GeolocationPositionErrorLike): void => {
      try {
        geolocation.getCurrentPosition(
          (position) => {
            const lng = position.coords.longitude;
            const lat = position.coords.latitude;
            if (!isValidCoordinatePair(lng, lat)) {
              finish({ ok: false, reason: t.webInvalidCoords });
              return;
            }
            const accuracy = normalizeAccuracyMeters(position.coords.accuracy);
            finish(buildSuccessResult(lng, lat, accuracy));
          },
          () => {
            finish({
              ok: false,
              reason: mapGeolocationError(primaryError, locale),
            });
          },
          FALLBACK_GEOLOCATION_OPTIONS,
        );
      } catch {
        finish({
          ok: false,
          reason: mapGeolocationError(primaryError, locale),
        });
      }
    };

    try {
      if (canWatch && geolocation.watchPosition) {
        const id = geolocation.watchPosition(
          (position) => {
            const lng = position.coords.longitude;
            const lat = position.coords.latitude;
            if (!isValidCoordinatePair(lng, lat)) {
              if (bestFix === null && refinementWindowMs <= 0) {
                finish({ ok: false, reason: t.webInvalidCoords });
              }
              return;
            }

            const accuracy = normalizeAccuracyMeters(position.coords.accuracy);
            const candidate = buildSuccessResult(lng, lat, accuracy);

            if (
              bestFix === null ||
              (accuracy !== undefined &&
                (bestFix.accuracyMeters === undefined ||
                  accuracy < bestFix.accuracyMeters))
            ) {
              bestFix = candidate;
            }

            // Precise GNSS / Wi-Fi fix (or accuracy omitted): settle immediately.
            if (
              accuracy === undefined ||
              accuracy <= PRECISE_ACCURACY_THRESHOLD_M ||
              refinementWindowMs <= 0
            ) {
              finish(bestFix);
              return;
            }

            // Coarse network/GeoIP reading (e.g. regional ISP hub in Frankfurt):
            // keep watching briefly so hardware GNSS / Wi-Fi can refine to user's position.
            if (refinementTimer === null) {
              refinementTimer = setTimeout(() => {
                refinementTimer = null;
                if (bestFix !== null) {
                  finish(bestFix);
                }
              }, refinementWindowMs);
            }
          },
          (error) => {
            if (bestFix !== null) {
              finish(bestFix);
              return;
            }
            if (error.code === 2 || error.code === 3) {
              cleanupWatch();
              tryLowAccuracyFallback(error);
              return;
            }
            finish({
              ok: false,
              reason: mapGeolocationError(error, locale),
            });
          },
          HIGH_ACCURACY_GEOLOCATION_OPTIONS,
        );
        watchId = id;
        if (settled && !watchCleared && typeof geolocation.clearWatch === 'function') {
          watchCleared = true;
          try {
            geolocation.clearWatch(id);
          } catch {
            // Ignore synchronous teardown errors.
          }
        }
        return;
      }

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
          const accuracy = normalizeAccuracyMeters(position.coords.accuracy);
          finish(buildSuccessResult(lng, lat, accuracy));
        },
        (error) => {
          if (error.code === 2 || error.code === 3) {
            tryLowAccuracyFallback(error);
            return;
          }
          finish({
            ok: false,
            reason: mapGeolocationError(error, locale),
          });
        },
        HIGH_ACCURACY_GEOLOCATION_OPTIONS,
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
