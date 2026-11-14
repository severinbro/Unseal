/**
 * Platform-neutral GPS coordinate acquisition result contract.
 *
 * Concrete platform suffix modules resolved via Metro and TypeScript `moduleSuffixes`:
 * - `./locateMe.native` (`expo-location` foreground permission + GPS fix on Android and iOS)
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
