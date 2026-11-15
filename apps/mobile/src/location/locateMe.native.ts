import * as Location from 'expo-location';

import {
  DEFAULT_LOCALE,
  getTranslations,
  type Locale,
} from '../i18n/translations';
import type { LocateMeResult } from './locateMe.types';

export type { LocateMeResult } from './locateMe.types';

const FRESH_LAST_KNOWN_MAX_AGE_MS = 45_000;
const FRESH_LAST_KNOWN_MAX_ACCURACY_M = 80;
const FALLBACK_LAST_KNOWN_MAX_AGE_MS = 180_000;
const FALLBACK_LAST_KNOWN_MAX_ACCURACY_M = 500;
const HIGH_ACCURACY_GRACE_AFTER_BALANCED_MS = 1_200;
const OVERALL_POSITION_TIMEOUT_MS = 5_000;

function isValidCoordinatePair(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90
  );
}

function toSuccessResult(
  position: Location.LocationObject,
): Extract<LocateMeResult, { ok: true }> | null {
  const { longitude, latitude, accuracy } = position.coords;
  if (!isValidCoordinatePair(longitude, latitude)) {
    return null;
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
}

export async function requestCurrentCoordinates(
  _nav?: unknown,
  _isSecureContext?: boolean,
  locale: Locale = DEFAULT_LOCALE,
  _refinementWindowMs?: number,
  onInterimFix?: (fix: Extract<LocateMeResult, { ok: true }>) => void,
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

    // 1. Instant return (<50ms) when OS FusedLocationProvider already has a fresh accurate fix.
    try {
      const freshCached = await Location.getLastKnownPositionAsync({
        maxAge: FRESH_LAST_KNOWN_MAX_AGE_MS,
        requiredAccuracy: FRESH_LAST_KNOWN_MAX_ACCURACY_M,
      });
      if (freshCached) {
        const parsedFresh = toSuccessResult(freshCached);
        if (parsedFresh) {
          return parsedFresh;
        }
      }
    } catch {
      // Continue to live location acquisition if cached fix check is unsupported.
    }

    let fallbackCachedFix: Extract<LocateMeResult, { ok: true }> | null = null;
    try {
      const recentCached = await Location.getLastKnownPositionAsync({
        maxAge: FALLBACK_LAST_KNOWN_MAX_AGE_MS,
        requiredAccuracy: FALLBACK_LAST_KNOWN_MAX_ACCURACY_M,
      });
      if (recentCached) {
        fallbackCachedFix = toSuccessResult(recentCached);
        if (fallbackCachedFix) {
          onInterimFix?.(fallbackCachedFix);
        }
      }
    } catch {
      // Ignore cached fallback errors.
    }

    // 2. Race fused Wi-Fi/cell/GNSS Balanced fix (~0.3–1s) against High-accuracy GNSS
    //    instead of blocking 15–30s waiting on cold satellite lock indoors.
    const liveFix = await new Promise<
      Extract<LocateMeResult, { ok: true }> | null
    >((resolve) => {
      let settled = false;
      let balancedCandidate: Extract<LocateMeResult, { ok: true }> | null =
        null;
      let pendingCount = 2;
      let graceTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (
        result: Extract<LocateMeResult, { ok: true }> | null,
      ): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (graceTimer !== null) {
          clearTimeout(graceTimer);
          graceTimer = null;
        }
        clearTimeout(overallTimer);
        resolve(result);
      };

      const markBranchFailed = (): void => {
        pendingCount -= 1;
        if (pendingCount <= 0) {
          finish(balancedCandidate);
        }
      };

      const overallTimer = setTimeout(() => {
        finish(balancedCandidate);
      }, OVERALL_POSITION_TIMEOUT_MS);

      Location.getCurrentPositionAsync({
        accuracy: Location.LocationAccuracy.High,
      })
        .then((pos) => {
          const parsed = toSuccessResult(pos);
          if (parsed) {
            finish(parsed);
          } else {
            markBranchFailed();
          }
        })
        .catch(() => {
          markBranchFailed();
        });

      Location.getCurrentPositionAsync({
        accuracy: Location.LocationAccuracy.Balanced,
      })
        .then((pos) => {
          const parsed = toSuccessResult(pos);
          if (!parsed) {
            markBranchFailed();
            return;
          }
          balancedCandidate = parsed;
          onInterimFix?.(parsed);
          // If fused Balanced fix is already street-accurate (<= 50 m), finish immediately.
          if (
            parsed.accuracyMeters !== undefined &&
            parsed.accuracyMeters <= 50
          ) {
            finish(parsed);
            return;
          }
          // Otherwise allow a brief window for hardware GNSS to refine before settling.
          if (!settled && graceTimer === null) {
            graceTimer = setTimeout(() => {
              graceTimer = null;
              finish(balancedCandidate);
            }, HIGH_ACCURACY_GRACE_AFTER_BALANCED_MS);
          }
        })
        .catch(() => {
          markBranchFailed();
        });
    });

    if (liveFix) {
      return liveFix;
    }
    if (fallbackCachedFix) {
      return fallbackCachedFix;
    }

    const lowFallback = await Location.getCurrentPositionAsync({
      accuracy: Location.LocationAccuracy.Low,
    });
    const parsedLow = toSuccessResult(lowFallback);
    if (!parsedLow) {
      return {
        ok: false,
        reason: t.nativeInvalidCoords,
      };
    }
    return parsedLow;
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message.trim() : '';
    const suffix = detail.length > 0 ? ` (${detail})` : '';
    return {
      ok: false,
      reason: t.nativeGenericError(suffix),
    };
  }
}
