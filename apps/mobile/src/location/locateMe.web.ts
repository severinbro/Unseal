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

export interface GeolocationPermissionStatusLike {
  readonly state: string;
  onchange?: (() => void) | null;
}

export interface GeolocationPermissionsLike {
  query?(descriptor: { readonly name: 'geolocation' }): Promise<GeolocationPermissionStatusLike>;
}

export interface WebNavigatorLike {
  readonly geolocation?: GeolocationLike | null;
  readonly permissions?: GeolocationPermissionsLike | null;
}

/**
 * Allows reusing a fresh (<30s) browser fix immediately while still refining
 * via `watchPosition` whenever the cached reading is coarse (>250 m).
 */
export const HIGH_ACCURACY_GEOLOCATION_OPTIONS: GeolocationPositionOptionsLike = {
  enableHighAccuracy: true,
  timeout: 4_500,
  maximumAge: 30_000,
};

export const FALLBACK_GEOLOCATION_OPTIONS: GeolocationPositionOptionsLike = {
  enableHighAccuracy: false,
  timeout: 3_500,
  maximumAge: 120_000,
};

/**
 * Threshold in meters for accepting a browser geolocation reading immediately
 * without waiting for further GNSS / Wi-Fi refinement. Coarse ISP/GeoIP fixes
 * (typically 3,000–50,000 m, e.g. regional backbone hubs) exceed this and wait
 * briefly for hardware GPS or Wi-Fi triangulation to lock onto the user.
 */
export const PRECISE_ACCURACY_THRESHOLD_M = 250;
export const INTERIM_PAN_MAX_ACCURACY_M = 2_500;
export const COARSE_REFINEMENT_WINDOW_MS = 1_500;
export const PARALLEL_LOW_ACCURACY_DELAY_MS = 250;
export const HARD_WEB_WATCHDOG_MS = 5_500;
export const PROMPT_PENDING_WATCHDOG_MS = 30_000;

export interface WebTimingOverrides {
  readonly parallelLowAccuracyDelayMs?: number;
  readonly hardWatchdogMs?: number;
}

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

function isBetterWebFix(
  candidate: Extract<LocateMeResult, { ok: true }>,
  current: Extract<LocateMeResult, { ok: true }> | null,
): boolean {
  if (current === null) {
    return true;
  }
  if (candidate.accuracyMeters === undefined) {
    return false;
  }
  if (current.accuracyMeters === undefined) {
    return true;
  }
  return candidate.accuracyMeters < current.accuracyMeters;
}

export async function requestCurrentCoordinates(
  nav?: WebNavigatorLike | null,
  isSecureContext?: boolean,
  locale: Locale = DEFAULT_LOCALE,
  refinementWindowMs: number = COARSE_REFINEMENT_WINDOW_MS,
  onInterimFix?: (fix: Extract<LocateMeResult, { ok: true }>) => void,
  timingOverrides?: WebTimingOverrides,
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

  const parallelDelayMs =
    timingOverrides?.parallelLowAccuracyDelayMs ??
    PARALLEL_LOW_ACCURACY_DELAY_MS;
  const hardWatchdogMs =
    timingOverrides?.hardWatchdogMs ??
    Math.max(HARD_WEB_WATCHDOG_MS, refinementWindowMs + 1_000);

  return new Promise<LocateMeResult>((resolve) => {
    let settled = false;
    let watchId: number | null = null;
    let watchCleared = false;
    let refinementTimer: ReturnType<typeof setTimeout> | null = null;
    let parallelFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let permissionStatusRef: GeolocationPermissionStatusLike | null = null;
    let bestFix: Extract<LocateMeResult, { ok: true }> | null = null;
    let primaryErrorRecorded: GeolocationPositionErrorLike | null = null;
    let fallbackStarted = false;
    let fallbackFailed = false;

    const clearActiveWatch = (): void => {
      if (
        !watchCleared &&
        watchId !== null &&
        typeof geolocation.clearWatch === 'function'
      ) {
        watchCleared = true;
        try {
          geolocation.clearWatch(watchId);
        } catch {
          // Ignore clearWatch errors during teardown.
        }
      }
    };

    const cleanupAll = (): void => {
      if (refinementTimer !== null) {
        clearTimeout(refinementTimer);
        refinementTimer = null;
      }
      if (parallelFallbackTimer !== null) {
        clearTimeout(parallelFallbackTimer);
        parallelFallbackTimer = null;
      }
      if (watchdogTimer !== null) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
      if (permissionStatusRef !== null) {
        try {
          permissionStatusRef.onchange = null;
        } catch {
          // Ignore readonly permission status implementations.
        }
        permissionStatusRef = null;
      }
      clearActiveWatch();
    };

    const finish = (result: LocateMeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupAll();
      resolve(result);
    };

    const acceptCandidatePosition = (
      position: GeolocationPositionLike,
      fromFallback: boolean,
    ): void => {
      if (settled) {
        return;
      }
      if (parallelFallbackTimer !== null) {
        clearTimeout(parallelFallbackTimer);
        parallelFallbackTimer = null;
      }

      const lng = position.coords.longitude;
      const lat = position.coords.latitude;
      if (!isValidCoordinatePair(lng, lat)) {
        if (
          bestFix === null &&
          (!canWatch || (fromFallback && primaryErrorRecorded !== null) || refinementWindowMs <= 0)
        ) {
          finish({ ok: false, reason: t.webInvalidCoords });
        }
        return;
      }

      const accuracy = normalizeAccuracyMeters(position.coords.accuracy);
      const candidate = buildSuccessResult(lng, lat, accuracy);

      if (isBetterWebFix(candidate, bestFix)) {
        bestFix = candidate;
        // Pan map immediately for neighborhood-grade fixes while waiting for street GPS,
        // without jumping prematurely to regional ISP/GeoIP hubs (>2.5 km away).
        if (
          accuracy !== undefined &&
          accuracy > PRECISE_ACCURACY_THRESHOLD_M &&
          accuracy <= INTERIM_PAN_MAX_ACCURACY_M
        ) {
          onInterimFix?.(candidate);
        }
      }

      // Precise GNSS / Wi-Fi fix (or accuracy omitted, or single-shot fallback after primary failed): settle immediately.
      if (
        accuracy === undefined ||
        accuracy <= PRECISE_ACCURACY_THRESHOLD_M ||
        refinementWindowMs <= 0 ||
        !canWatch ||
        primaryErrorRecorded !== null
      ) {
        finish(bestFix ?? candidate);
        return;
      }

      // Coarse reading: keep watching briefly so hardware GNSS / Wi-Fi can refine.
      if (refinementTimer === null) {
        refinementTimer = setTimeout(() => {
          refinementTimer = null;
          if (bestFix !== null) {
            finish(bestFix);
          }
        }, refinementWindowMs);
      }
    };

    const startLowAccuracyFallback = (): void => {
      if (settled || fallbackStarted) {
        return;
      }
      fallbackStarted = true;
      if (parallelFallbackTimer !== null) {
        clearTimeout(parallelFallbackTimer);
        parallelFallbackTimer = null;
      }

      try {
        geolocation.getCurrentPosition(
          (position) => {
            acceptCandidatePosition(position, true);
          },
          (fallbackError) => {
            if (fallbackError.code === 1) {
              finish({
                ok: false,
                reason: mapGeolocationError(fallbackError, locale),
              });
              return;
            }
            fallbackFailed = true;
            if (bestFix !== null) {
              finish(bestFix);
              return;
            }
            if (primaryErrorRecorded !== null) {
              finish({
                ok: false,
                reason: mapGeolocationError(primaryErrorRecorded, locale),
              });
            }
          },
          FALLBACK_GEOLOCATION_OPTIONS,
        );
      } catch {
        fallbackFailed = true;
        if (bestFix !== null) {
          finish(bestFix);
          return;
        }
        if (primaryErrorRecorded !== null) {
          finish({
            ok: false,
            reason: mapGeolocationError(primaryErrorRecorded, locale),
          });
        }
      }
    };

    const handlePrimaryError = (error: GeolocationPositionErrorLike): void => {
      if (settled) {
        return;
      }
      if (error.code === 1) {
        finish({
          ok: false,
          reason: mapGeolocationError(error, locale),
        });
        return;
      }
      if (bestFix !== null) {
        finish(bestFix);
        return;
      }
      primaryErrorRecorded = error;
      clearActiveWatch();

      if (error.code === 2 || error.code === 3) {
        if (!fallbackStarted) {
          startLowAccuracyFallback();
          return;
        }
        if (fallbackFailed) {
          finish({
            ok: false,
            reason: mapGeolocationError(error, locale),
          });
        }
        return;
      }

      finish({
        ok: false,
        reason: mapGeolocationError(error, locale),
      });
    };

    const armWatchdog = (delayMs: number): void => {
      if (settled) {
        return;
      }
      if (watchdogTimer !== null) {
        clearTimeout(watchdogTimer);
      }
      watchdogTimer = setTimeout(() => {
        watchdogTimer = null;
        if (bestFix !== null) {
          finish(bestFix);
          return;
        }
        finish({
          ok: false,
          reason: primaryErrorRecorded
            ? mapGeolocationError(primaryErrorRecorded, locale)
            : t.webTimeout,
        });
      }, delayMs);
    };

    // JS-level watchdog protects against stalled OS/browser geolocation backends
    // (e.g. hung GeoClue2 D-Bus or WebView providers that fail to fire errorCallback),
    // while giving first-time users reading a browser permission prompt time to decide.
    armWatchdog(hardWatchdogMs);
    if (
      timingOverrides?.hardWatchdogMs === undefined &&
      typeof resolvedNav.permissions?.query === 'function'
    ) {
      void resolvedNav.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (settled || status.state !== 'prompt') {
            return;
          }
          permissionStatusRef = status;
          armWatchdog(Math.max(PROMPT_PENDING_WATCHDOG_MS, hardWatchdogMs));
          try {
            status.onchange = () => {
              if (!settled && status.state !== 'prompt') {
                armWatchdog(hardWatchdogMs);
              }
            };
          } catch {
            // Ignore environments where onchange cannot be assigned.
          }
        })
        .catch(() => {
          // Keep standard watchdog when Permissions API query is unsupported.
        });
    }

    try {
      // Launch low-accuracy / cached network probe in parallel if high-accuracy GNSS
      // does not emit an immediate fix within `parallelDelayMs` (~250ms), eliminating
      // the sequential 5s + 4s = 9s wait on desktops and indoor mobile browsers.
      if (parallelDelayMs >= 0) {
        parallelFallbackTimer = setTimeout(() => {
          parallelFallbackTimer = null;
          if (!settled && bestFix === null) {
            startLowAccuracyFallback();
          }
        }, parallelDelayMs);
      }

      if (canWatch && geolocation.watchPosition) {
        const id = geolocation.watchPosition(
          (position) => {
            acceptCandidatePosition(position, false);
          },
          handlePrimaryError,
          HIGH_ACCURACY_GEOLOCATION_OPTIONS,
        );
        watchId = id;
        if (
          settled &&
          !watchCleared &&
          typeof geolocation.clearWatch === 'function'
        ) {
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
          acceptCandidatePosition(position, false);
        },
        handlePrimaryError,
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
