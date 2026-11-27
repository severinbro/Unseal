// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

/**
 * GPS coordinate acquisition result contract, implemented by
 * - `./locateMe.web` (`navigator.geolocation` with HTTPS secure-context validation on Web)
 */
export type LocateMeResult =
  | {
      ok: true;
      lng: number;
      lat: number;
      accuracyMeters?: number;
    }
  | {
      ok: false;
      reason: string;
    };
