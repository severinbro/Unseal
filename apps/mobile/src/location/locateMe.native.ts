// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

import type { LocationAccuracy } from 'expo-location';

import {
  DEFAULT_LOCALE,
  getTranslations,
  type Locale,
} from '../i18n/translations';
import type { LocateMeResult } from './locateMe.types';

export type { LocateMeResult } from './locateMe.types';

export const NATIVE_LOCATION_ACCURACY = {
  Lowest: 1 as LocationAccuracy,
  Low: 2 as LocationAccuracy,
  Balanced: 3 as LocationAccuracy,
  High: 4 as LocationAccuracy,
  Highest: 5 as LocationAccuracy,
  BestForNavigation: 6 as LocationAccuracy,
} as const;

export const FRESH_LAST_KNOWN_MAX_AGE_MS = 60_000;
export const FRESH_LAST_KNOWN_MAX_ACCURACY_M = 100;
export const FALLBACK_LAST_KNOWN_MAX_AGE_MS = 600_000;
export const FALLBACK_LAST_KNOWN_MAX_ACCURACY_M = 1_500;
export const STALE_STREAM_FIX_MAX_AGE_MS = 600_000;
export const STREET_ACCURACY_THRESHOLD_M = 50;
export const INTERIM_PAN_MAX_ACCURACY_M = 2_500;
export const HIGH_ACCURACY_GRACE_AFTER_BALANCED_MS = 1_200;
export const WARM_FIX_TIMEOUT_MS = 3_500;
export const COLD_GNSS_HARD_TIMEOUT_MS = 10_000;

export interface NativeLocationCoordsLike {
  readonly longitude: number;
  readonly latitude: number;
  readonly accuracy?: number | null;
}

export interface NativeLocationObjectLike {
  readonly coords: NativeLocationCoordsLike;
  readonly timestamp?: number;
}

export interface NativePermissionResponseLike {
  readonly granted: boolean;
  readonly canAskAgain?: boolean;
}

export interface NativeLocationSubscriptionLike {
  remove(): void;
}

export interface NativeLocationWatchOptionsLike {
  readonly accuracy?: LocationAccuracy;
  readonly distanceInterval?: number;
  readonly timeInterval?: number;
  readonly mayShowUserSettingsDialog?: boolean;
}

export interface NativeLastKnownOptionsLike {
  readonly maxAge?: number;
  readonly requiredAccuracy?: number;
}

export interface NativeLocationModuleLike {
  requestForegroundPermissionsAsync(): Promise<NativePermissionResponseLike>;
  hasServicesEnabledAsync?(): Promise<boolean>;
  getLastKnownPositionAsync(
    options?: NativeLastKnownOptionsLike,
  ): Promise<NativeLocationObjectLike | null>;
  watchPositionAsync?(
    options: NativeLocationWatchOptionsLike,
    callback: (location: NativeLocationObjectLike) => void,
    errorHandler?: (reason: string) => void,
  ): Promise<NativeLocationSubscriptionLike>;
  getCurrentPositionAsync(
    options?: NativeLocationWatchOptionsLike,
  ): Promise<NativeLocationObjectLike>;
}

async function resolveDefaultLocationModule(): Promise<NativeLocationModuleLike> {
  return import('expo-location');
}

function isValidCoordinatePair(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90
  );
}

function toSuccessResult(
  position: NativeLocationObjectLike,
  maxAgeMs?: number,
  nowMs: number = Date.now(),
): Extract<LocateMeResult, { ok: true }> | null {
  const { longitude, latitude, accuracy } = position.coords;
  if (!isValidCoordinatePair(longitude, latitude)) {
    return null;
  }
  // CoreLocation reports negative horizontalAccuracy when coordinates are invalid.
  if (typeof accuracy === 'number' && (!Number.isFinite(accuracy) || accuracy < 0)) {
    return null;
  }
  if (
    maxAgeMs !== undefined &&
    typeof position.timestamp === 'number' &&
    Number.isFinite(position.timestamp) &&
    position.timestamp > 0 &&
    nowMs - position.timestamp > maxAgeMs
  ) {
    return null;
  }
  return {
    ok: true,
    lng: longitude,
    lat: latitude,
    ...(typeof accuracy === 'number' ? { accuracyMeters: accuracy } : {}),
  };
}

function isBetterFix(
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

export interface NativeTimingOverrides {
  readonly warmTimeoutMs?: number;
  readonly coldHardTimeoutMs?: number;
  readonly now?: () => number;
}

export async function requestCurrentCoordinates(
  _nav?: unknown,
  _isSecureContext?: boolean,
  locale: Locale = DEFAULT_LOCALE,
  refinementWindowMs: number = HIGH_ACCURACY_GRACE_AFTER_BALANCED_MS,
  onInterimFix?: (fix: Extract<LocateMeResult, { ok: true }>) => void,
  locationModule?: NativeLocationModuleLike,
  timingOverrides?: NativeTimingOverrides,
): Promise<LocateMeResult> {
  const t = getTranslations(locale).location;
  const nowFn = timingOverrides?.now ?? Date.now;
  const warmTimeoutMs = timingOverrides?.warmTimeoutMs ?? WARM_FIX_TIMEOUT_MS;
  const coldHardTimeoutMs = Math.max(
    warmTimeoutMs,
    timingOverrides?.coldHardTimeoutMs ?? COLD_GNSS_HARD_TIMEOUT_MS,
  );

  try {
    const locationApi = locationModule ?? (await resolveDefaultLocationModule());

    const permission = await locationApi.requestForegroundPermissionsAsync();
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

    if (typeof locationApi.hasServicesEnabledAsync === 'function') {
      const enabled = await locationApi.hasServicesEnabledAsync();
      if (!enabled) {
        return {
          ok: false,
          reason: t.nativeGenericError(''),
        };
      }
    }

    // 1. Instant return (<50ms) when OS FusedLocationProvider / locationd has a fresh accurate fix.
    try {
      const freshCached = await locationApi.getLastKnownPositionAsync({
        maxAge: FRESH_LAST_KNOWN_MAX_AGE_MS,
        requiredAccuracy: FRESH_LAST_KNOWN_MAX_ACCURACY_M,
      });
      if (freshCached) {
        const parsedFresh = toSuccessResult(
          freshCached,
          FRESH_LAST_KNOWN_MAX_AGE_MS,
          nowFn(),
        );
        if (parsedFresh) {
          return parsedFresh;
        }
      }
    } catch {
      // Continue to live location acquisition if cached fix check is unsupported.
    }

    // 2. Warm recent cache (<10 min) for immediate interim camera pan while live sensors refine.
    let fallbackCachedFix: Extract<LocateMeResult, { ok: true }> | null = null;
    try {
      const recentCached = await locationApi.getLastKnownPositionAsync({
        maxAge: FALLBACK_LAST_KNOWN_MAX_AGE_MS,
        requiredAccuracy: FALLBACK_LAST_KNOWN_MAX_ACCURACY_M,
      });
      if (recentCached) {
        fallbackCachedFix = toSuccessResult(
          recentCached,
          FALLBACK_LAST_KNOWN_MAX_AGE_MS,
          nowFn(),
        );
        if (fallbackCachedFix) {
          onInterimFix?.(fallbackCachedFix);
        }
      }
    } catch {
      // Ignore cached fallback errors.
    }

    // 3. Stream cancellable Balanced (Wi-Fi/cell) + High (GNSS) updates in parallel with
    //    `mayShowUserSettingsDialog: false` (avoiding blocking system Location Accuracy modals)
    //    and strict two-stage timeouts (fast settle when warm, bounded cold GNSS window, zero hangs).
    const canWatch = typeof locationApi.watchPositionAsync === 'function';

    const liveFix = await new Promise<
      Extract<LocateMeResult, { ok: true }> | null
    >((resolve) => {
      let settled = false;
      let warmElapsed = false;
      let bestFix: Extract<LocateMeResult, { ok: true }> | null = null;
      let pendingStreams = 2;
      let graceTimer: ReturnType<typeof setTimeout> | null = null;
      const subscriptions: NativeLocationSubscriptionLike[] = [];

      const cleanupAll = (): void => {
        if (graceTimer !== null) {
          clearTimeout(graceTimer);
          graceTimer = null;
        }
        clearTimeout(warmTimer);
        clearTimeout(hardTimer);
        while (subscriptions.length > 0) {
          const sub = subscriptions.pop();
          try {
            sub?.remove();
          } catch {
            // Ignore teardown errors on already-removed native subscriptions.
          }
        }
      };

      const finish = (
        result: Extract<LocateMeResult, { ok: true }> | null,
      ): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanupAll();
        resolve(result);
      };

      const markStreamFailed = (): void => {
        pendingStreams -= 1;
        if (pendingStreams <= 0) {
          finish(bestFix);
        }
      };

      const handleCandidatePosition = (pos: NativeLocationObjectLike): void => {
        if (settled) {
          return;
        }
        const parsed = toSuccessResult(
          pos,
          STALE_STREAM_FIX_MAX_AGE_MS,
          nowFn(),
        );
        if (!parsed) {
          return;
        }

        if (isBetterFix(parsed, bestFix)) {
          bestFix = parsed;
          if (
            parsed.accuracyMeters === undefined ||
            parsed.accuracyMeters <= INTERIM_PAN_MAX_ACCURACY_M
          ) {
            onInterimFix?.(parsed);
          }
        }

        // Street-accurate fix, zero refinement window, or already in cold-GNSS overtime: settle now.
        if (
          (parsed.accuracyMeters !== undefined &&
            parsed.accuracyMeters <= STREET_ACCURACY_THRESHOLD_M) ||
          refinementWindowMs <= 0 ||
          warmElapsed
        ) {
          finish(bestFix);
          return;
        }

        if (graceTimer === null) {
          graceTimer = setTimeout(() => {
            graceTimer = null;
            finish(bestFix);
          }, refinementWindowMs);
        }
      };

      // Stage 1 timer: if any warm/cached or live fix is available, never block past warmTimeoutMs.
      // Only when no fix at all exists yet (true cold satellite start without network location),
      // keep the High GNSS watcher alive up to coldHardTimeoutMs instead of discarding its lock.
      const warmTimer = setTimeout(() => {
        warmElapsed = true;
        if (bestFix !== null || fallbackCachedFix !== null) {
          finish(bestFix);
        }
      }, warmTimeoutMs);

      // Stage 2 hard ceiling: guarantees deterministic completion and watcher teardown.
      const hardTimer = setTimeout(() => {
        finish(bestFix);
      }, coldHardTimeoutMs);

      if (canWatch && locationApi.watchPositionAsync) {
        for (const accuracy of [
          NATIVE_LOCATION_ACCURACY.High,
          NATIVE_LOCATION_ACCURACY.Balanced,
        ]) {
          let streamFailed = false;
          const failOnce = (): void => {
            if (streamFailed) {
              return;
            }
            streamFailed = true;
            markStreamFailed();
          };

          locationApi
            .watchPositionAsync(
              {
                accuracy,
                distanceInterval: 0,
                timeInterval: 500,
                mayShowUserSettingsDialog: false,
              },
              handleCandidatePosition,
              () => {
                failOnce();
              },
            )
            .then((sub) => {
              if (settled) {
                try {
                  sub.remove();
                } catch {
                  // Ignore late teardown error.
                }
                return;
              }
              subscriptions.push(sub);
            })
            .catch(() => {
              failOnce();
            });
        }
        return;
      }

      // Bounded single-shot fallback if watchPositionAsync is unavailable.
      for (const accuracy of [
        NATIVE_LOCATION_ACCURACY.High,
        NATIVE_LOCATION_ACCURACY.Balanced,
      ]) {
        locationApi
          .getCurrentPositionAsync({
            accuracy,
            mayShowUserSettingsDialog: false,
          })
          .then((pos) => {
            const parsed = toSuccessResult(
              pos,
              STALE_STREAM_FIX_MAX_AGE_MS,
              nowFn(),
            );
            if (!parsed) {
              markStreamFailed();
              return;
            }
            handleCandidatePosition(pos);
          })
          .catch(() => {
            markStreamFailed();
          });
      }
    });

    if (liveFix) {
      return liveFix;
    }
    if (fallbackCachedFix) {
      return fallbackCachedFix;
    }

    return {
      ok: false,
      reason: t.nativeGenericError(''),
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
