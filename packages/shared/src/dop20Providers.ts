// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 OpenUnseal Contributors

export type Dop20LicenseId = 'dl-de/by-2-0' | 'CC BY 4.0' | 'dl-de/zero-2-0';

export const DOP20_LICENSE_URLS: Readonly<Record<Dop20LicenseId, string>> = {
  'dl-de/by-2-0': 'https://www.govdata.de/dl-de/by-2-0',
  'dl-de/zero-2-0': 'https://www.govdata.de/dl-de/zero-2-0',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
} as const;

export const GERMANY_DOP20_BOUNDS: readonly [number, number, number, number] = [
  5.86,
  47.27,
  15.05,
  55.06,
];

export interface StateDop20Provider {
  readonly code: string;
  readonly name: string;
  readonly boundsWgs84: readonly [number, number, number, number];
  readonly baseUrl: string;
  readonly layers: string;
  readonly licenseId: Dop20LicenseId;
  readonly licenseUrl: string;
  /** Concise agency attribution string (year-independent base form). */
  readonly attribution: string;
  /**
   * Publisher-prescribed full attribution wording (from the WMS GetCapabilities
   * or, where the service states none, the state's metadata catalogue / terms
   * of use) with `{year}` placeholder for retrieval/display year.
   */
  readonly fullAttributionTemplate: string;
  /** Compact on-map agency credit with `{year}` placeholder. */
  readonly shortCreditTemplate: string;
  /** Modification notice required when tiles are reprojected/composited. */
  readonly modifiedNote: string;
  /** Optional vintage/pinning note (e.g. Hamburg TIME=2026). */
  readonly vintageNote?: string;
}

/**
 * Official OpenData DOP20 / DOP10 RGB WMS 1.3.0 services of the 16 German Bundesländer
 * (Berlin and Brandenburg share the joint ISK GeoBasis-BB `bebb_dop20c` service).
 * Licenses and attribution wordings follow each service's WMS GetCapabilities
 * (RP, HE, NW, BW, BY, BE/BB, HH, NI, HB, SH, TH). Where the service itself
 * carries no license text (SL, SN, ST) or names no license (MV), they follow
 * the state's metadata catalogue / published terms of use instead.
 */
export const GERMAN_STATE_DOP20_PROVIDERS: readonly StateDop20Provider[] = [
  {
    code: 'RP',
    name: 'Rheinland-Pfalz',
    boundsWgs84: [6.11, 48.96, 8.51, 50.95],
    baseUrl: 'https://geo4.service24.rlp.de/wms/rp_dop20.fcgi',
    layers: 'rp_dop20',
    licenseId: 'dl-de/by-2-0',
    licenseUrl: DOP20_LICENSE_URLS['dl-de/by-2-0'],
    attribution: '©GeoBasis-DE / LVermGeoRP, http://www.lvermgeo.rlp.de',
    fullAttributionTemplate:
      '©GeoBasis-DE / LVermGeoRP ({year}), dl-de/by-2-0, http://www.lvermgeo.rlp.de [Daten bearbeitet]',
    shortCreditTemplate: '©GeoBasis-DE / LVermGeoRP ({year}), http://www.lvermgeo.rlp.de',
    modifiedNote: 'Daten bearbeitet',
  },
  {
    code: 'HE',
    name: 'Hessen',
    boundsWgs84: [7.77, 49.39, 10.24, 51.66],
    baseUrl:
      'https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows',
    layers: 'he_dop_rgb',
    licenseId: 'dl-de/zero-2-0',
    licenseUrl: DOP20_LICENSE_URLS['dl-de/zero-2-0'],
    attribution: '© Hessische Verwaltung für Bodenmanagement und Geoinformation (HVBG)',
    fullAttributionTemplate:
      '© Hessische Verwaltung für Bodenmanagement und Geoinformation (HVBG) ({year}), dl-de/zero-2-0 (Daten verändert)',
    shortCreditTemplate: '© HVBG ({year})',
    modifiedNote: 'Daten verändert',
  },
  {
    code: 'NW',
    name: 'Nordrhein-Westfalen',
    boundsWgs84: [5.86, 50.32, 9.47, 52.54],
    baseUrl: 'https://www.wms.nrw.de/geobasis/wms_nw_dop',
    layers: 'nw_dop_rgb',
    licenseId: 'dl-de/zero-2-0',
    licenseUrl: DOP20_LICENSE_URLS['dl-de/zero-2-0'],
    attribution: '© Land NRW (Geobasis NRW)',
    fullAttributionTemplate:
      '© Land NRW (Geobasis NRW) ({year}), dl-de/zero-2-0 (Daten verändert)',
    shortCreditTemplate: '© Land NRW (Geobasis NRW, {year})',
    modifiedNote: 'Daten verändert',
  },
  {
    code: 'BW',
    name: 'Baden-Württemberg',
    boundsWgs84: [7.51, 47.53, 10.5, 49.8],
    baseUrl:
      'https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_INSP_BW_Orthofoto_DOP20',
    layers: 'OI.OrthoimageCoverage',
    licenseId: 'dl-de/by-2-0',
    licenseUrl: DOP20_LICENSE_URLS['dl-de/by-2-0'],
    attribution:
      'LGL-BW, Datenlizenz Deutschland - Namensnennung - Version 2.0, www.lgl-bw.de',
    fullAttributionTemplate:
      'LGL-BW ({year}) Datenlizenz Deutschland - Namensnennung - Version 2.0, www.lgl-bw.de (Daten verändert)',
    shortCreditTemplate: 'LGL-BW ({year}), www.lgl-bw.de',
    modifiedNote: 'Daten verändert',
  },
  {
    code: 'BY',
    name: 'Bayern',
    boundsWgs84: [8.97, 47.27, 13.84, 50.57],
    baseUrl: 'https://geoservices.bayern.de/od/wms/dop/v1/dop20',
    layers: 'by_dop20c',
    licenseId: 'CC BY 4.0',
    licenseUrl: DOP20_LICENSE_URLS['CC BY 4.0'],
    attribution:
      'Datenquelle: Bayerische Vermessungsverwaltung - www.geodaten.bayern.de',
    fullAttributionTemplate:
      'Datenquelle: Bayerische Vermessungsverwaltung - www.geodaten.bayern.de ({year}), CC BY 4.0 (Daten verändert)',
    shortCreditTemplate:
      'Bayerische Vermessungsverwaltung ({year}), www.geodaten.bayern.de',
    modifiedNote: 'Daten verändert',
  },
  {
    code: 'SL',
    name: 'Saarland',
    boundsWgs84: [6.34, 49.08, 7.44, 49.66],
    baseUrl: 'https://geoportal.saarland.de/freewms/dop2023',
    layers: 'sl_dop20_rgb',
    licenseId: 'dl-de/by-2-0',
    licenseUrl: DOP20_LICENSE_URLS['dl-de/by-2-0'],
    // Wording per the Saarland geoportal metadata record "ATKIS - DOP 2023"
    // (the freewms GetCapabilities itself states no license).
    attribution: '© GeoBasis DE/LVGL-SL',
    fullAttributionTemplate:
      '© GeoBasis DE/LVGL-SL ({year}), dl-de/by-2-0 (Daten verändert)',
    shortCreditTemplate: '© GeoBasis DE/LVGL-SL ({year})',
    modifiedNote: 'Daten verändert',
  },
  {
    code: 'BE_BB',
    name: 'Berlin / Brandenburg',
    boundsWgs84: [11.26, 51.35, 14.77, 53.56],
    baseUrl: 'https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms',
    layers: 'bebb_dop20c',
    licenseId: 'dl-de/by-2-0',
    licenseUrl: DOP20_LICENSE_URLS['dl-de/by-2-0'],
    // Brandenburg (LGB) imagery is dl-de/by-2-0. Berlin publishes its own
    // orthophotos under dl-de/zero-2-0 (Berlin data register / Geoportal Berlin);
    // the joint service's GetCapabilities still shows the older by-2-0 wording
    // for the Berlin part. The Berlin credit is kept and labelled with Berlin's
    // actual license.
    attribution:
      '© GeoBasis-DE / LGB, dl-de/by-2-0; © Geoportal Berlin, dl-de/zero-2-0',
    fullAttributionTemplate:
      '© GeoBasis-DE / LGB ({year}), dl-de/by-2-0; © Geoportal Berlin ({year}), dl-de/zero-2-0 (Daten verändert)',
    shortCreditTemplate: '© GeoBasis-DE / LGB & © Geoportal Berlin ({year})',
    modifiedNote: 'Daten verändert',
  },
  {
    code: 'HH',
    name: 'Hamburg',
    boundsWgs84: [8.42, 53.39, 10.33, 53.97],
    // Pin TIME=2026 to LGV Hamburg's own dl-de/by-2-0 OpenData aerial flight,
    // excluding the 2023 Maxar satellite vintage ("other-closed") in this WMS-Time service.
    baseUrl: 'https://geodienste.hamburg.de/wms_dop_zeitreihe_unbelaubt?TIME=2026',
    layers: 'dop_zeitreihe_unbelaubt',
    licenseId: 'dl-de/by-2-0',
    licenseUrl: DOP20_LICENSE_URLS['dl-de/by-2-0'],
    attribution:
      '© Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV)',
    fullAttributionTemplate:
      '© Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV) ({year}), dl-de/by-2-0 (Daten verändert)',
    shortCreditTemplate: '© Freie und Hansestadt Hamburg, LGV ({year})',
    modifiedNote: 'Daten verändert',
    vintageNote: 'TIME=2026 LGV-OpenData-Befliegung',
  },
  {
    code: 'NI',
    name: 'Niedersachsen',
    boundsWgs84: [6.65, 51.29, 11.6, 53.9],
    baseUrl: 'https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms',
    layers: 'ni_dop20',
    licenseId: 'CC BY 4.0',
    licenseUrl: DOP20_LICENSE_URLS['CC BY 4.0'],
    attribution:
      'LGLN Creative Commons Namensnennung - 4.0 International (CC BY 4.0)',
    fullAttributionTemplate:
      'LGLN ({year}) Creative Commons Namensnennung - 4.0 International (CC BY 4.0) (Daten verändert)',
    shortCreditTemplate: 'LGLN ({year})',
    modifiedNote: 'Daten verändert',
  },
  {
    code: 'HB',
    name: 'Bremen / Bremerhaven',
    boundsWgs84: [8.48, 53.01, 8.99, 53.62],
    baseUrl: 'https://geodienste.bremen.de/wms_dop10_2023',
    layers: 'DOP10_2023_HB,DOP10_2023_BHV',
    licenseId: 'CC BY 4.0',
    licenseUrl: DOP20_LICENSE_URLS['CC BY 4.0'],
    attribution: '© Landesamt GeoInformation Bremen',
    fullAttributionTemplate:
      '© Landesamt GeoInformation Bremen ({year}), CC BY 4.0 (Daten verändert)',
    shortCreditTemplate: '© Landesamt GeoInformation Bremen ({year})',
    modifiedNote: 'Daten verändert',
  },
  {
    code: 'SH',
    name: 'Schleswig-Holstein',
    boundsWgs84: [7.86, 53.35, 11.32, 55.06],
    baseUrl: 'https://dienste.gdi-sh.de/WMS_SH_DOP20col_OpenGBD',
    layers: 'sh_dop20_rgb',
    licenseId: 'CC BY 4.0',
    licenseUrl: DOP20_LICENSE_URLS['CC BY 4.0'],
    attribution: '© GeoBasis-DE/LVermGeo SH/CC BY 4.0',
    fullAttributionTemplate:
      '© GeoBasis-DE/LVermGeo SH/CC BY 4.0 ({year}; Daten verändert)',
    shortCreditTemplate: '© GeoBasis-DE/LVermGeo SH ({year})',
    modifiedNote: 'Daten verändert',
  },
  {
    code: 'MV',
    name: 'Mecklenburg-Vorpommern',
    boundsWgs84: [10.59, 53.11, 14.42, 54.69],
    baseUrl: 'https://www.geodaten-mv.de/dienste/adv_dop',
    layers: 'mv_dop',
    licenseId: 'CC BY 4.0',
    licenseUrl: DOP20_LICENSE_URLS['CC BY 4.0'],
    attribution: '© GeoBasis-DE/M-V (https://www.laiv-mv.de)',
    fullAttributionTemplate:
      '© GeoBasis-DE/M-V {year} (https://www.laiv-mv.de), CC BY 4.0 (Daten verändert)',
    shortCreditTemplate: '© GeoBasis-DE/M-V {year} (https://www.laiv-mv.de)',
    modifiedNote: 'Daten verändert',
  },
  {
    code: 'SN',
    name: 'Sachsen',
    boundsWgs84: [11.87, 50.17, 15.05, 51.69],
    baseUrl: 'https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest',
    layers: 'sn_dop_020',
    licenseId: 'dl-de/by-2-0',
    licenseUrl: DOP20_LICENSE_URLS['dl-de/by-2-0'],
    // Wording per GeoSN's general terms of use ("Quelle: GeoSN, dl-de/by-2-0");
    // the WMS GetCapabilities only links to those terms.
    attribution: 'Quelle: GeoSN, dl-de/by-2-0',
    fullAttributionTemplate:
      'Quelle: GeoSN, dl-de/by-2-0 ({year}; Daten verändert)',
    shortCreditTemplate: 'Quelle: GeoSN ({year})',
    modifiedNote: 'Daten verändert',
  },
  {
    code: 'ST',
    name: 'Sachsen-Anhalt',
    boundsWgs84: [10.56, 50.93, 13.19, 53.05],
    baseUrl:
      'https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest',
    layers: 'lsa_lvermgeo_dop20_2',
    licenseId: 'dl-de/by-2-0',
    licenseUrl: DOP20_LICENSE_URLS['dl-de/by-2-0'],
    attribution: '© GeoBasis-DE / LVermGeo ST',
    fullAttributionTemplate:
      '© GeoBasis-DE / LVermGeo ST ({year}), dl-de/by-2-0 (Daten verändert)',
    shortCreditTemplate: '© GeoBasis-DE / LVermGeo ST ({year})',
    modifiedNote: 'Daten verändert',
  },
  {
    code: 'TH',
    name: 'Thüringen',
    boundsWgs84: [9.87, 50.2, 12.66, 51.65],
    baseUrl: 'https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP',
    layers: 'th_dop',
    licenseId: 'CC BY 4.0',
    licenseUrl: DOP20_LICENSE_URLS['CC BY 4.0'],
    attribution: '© GDI-Th',
    fullAttributionTemplate:
      '© GDI-Th ({year}), CC BY 4.0 (Daten verändert)',
    shortCreditTemplate: '© GDI-Th ({year})',
    modifiedNote: 'Daten verändert',
  },
];

function boxesIntersect(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeHref(url: string | null | undefined): url is string {
  if (!url) {
    return false;
  }
  const trimmed = url.trim();
  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('/')
  );
}

export function selectDop20ProvidersForBounds(
  wgs84Bounds: readonly [number, number, number, number],
): StateDop20Provider[] {
  return GERMAN_STATE_DOP20_PROVIDERS.filter((provider) =>
    boxesIntersect(wgs84Bounds, provider.boundsWgs84),
  );
}

export function formatStateDop20FullAttribution(
  provider: StateDop20Provider,
  year: number = new Date().getUTCFullYear(),
): string {
  return provider.fullAttributionTemplate.replace(/\{year\}/g, String(year));
}

export function formatDefaultDop20Attribution(
  year: number = new Date().getUTCFullYear(),
): string {
  return `© GeoBasis-DE / Vermessungsverwaltungen der Bundesländer (${year}; DOP20/DOP10, dl-de/by-2-0, CC BY 4.0, dl-de/zero-2-0; Daten verändert)`;
}

function formatProviderWebHtml(
  provider: StateDop20Provider,
  year: number,
): string {
  const yearStr = String(year);
  const licenseLink = `<a href="${escapeHtml(provider.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(provider.licenseId)}</a>`;
  if (provider.code === 'RP') {
    return `©GeoBasis-DE / LVermGeoRP (${yearStr}), ${licenseLink}, <a href="http://www.lvermgeo.rlp.de" target="_blank" rel="noopener noreferrer">http://www.lvermgeo.rlp.de</a> [Daten bearbeitet]`;
  }
  if (provider.code === 'SH') {
    return `© GeoBasis-DE/LVermGeo SH/${licenseLink} (${yearStr}; Daten verändert)`;
  }
  if (provider.code === 'MV') {
    return `© GeoBasis-DE/M-V ${yearStr} (<a href="https://www.laiv-mv.de" target="_blank" rel="noopener noreferrer">https://www.laiv-mv.de</a>, ${licenseLink}, Daten verändert)`;
  }
  const credit = escapeHtml(
    provider.shortCreditTemplate.replace(/\{year\}/g, yearStr),
  );
  return `${credit} (${licenseLink}, ${escapeHtml(provider.modifiedNote)})`;
}

export interface FormatDop20WebAttributionOptions {
  year?: number | undefined;
  licensesUrl?: string | null | undefined;
  maxInlineProviders?: number | undefined;
}

/**
 * Formats an HTML attribution snippet for MapLibre GL JS `AttributionControl`
 * reflecting the exact German state DOP20/DOP10 provider(s) intersecting `bbox`,
 * with clickable license links (`dl-de/by-2-0`, `CC BY 4.0`, `dl-de/zero-2-0`)
 * and a fallback link to `/auth/licenses` when zoomed out across many states.
 */
export function formatDop20WebAttributionHtml(
  bbox: readonly [number, number, number, number] | null | undefined,
  options: FormatDop20WebAttributionOptions = {},
): string {
  const year = options.year ?? new Date().getUTCFullYear();
  const maxInline = options.maxInlineProviders ?? 4;
  const licensesHref = isSafeHref(options.licensesUrl)
    ? options.licensesUrl.trim()
    : null;

  const fallbackHtml = (): string => {
    const dlBy = `<a href="${DOP20_LICENSE_URLS['dl-de/by-2-0']}" target="_blank" rel="noopener noreferrer">dl-de/by-2-0</a>`;
    const ccBy = `<a href="${DOP20_LICENSE_URLS['CC BY 4.0']}" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>`;
    const dlZero = `<a href="${DOP20_LICENSE_URLS['dl-de/zero-2-0']}" target="_blank" rel="noopener noreferrer">dl-de/zero-2-0</a>`;
    const allStatesLink = licensesHref
      ? ` · <a href="${escapeHtml(licensesHref)}" target="_blank" rel="noopener noreferrer">Alle 16 Länder</a>`
      : '';
    return `DOP20/DOP10: © GeoBasis-DE / Vermessungsverwaltungen der Bundesländer (${year}; ${dlBy}, ${ccBy}, ${dlZero}; Daten verändert${allStatesLink})`;
  };

  if (!bbox) {
    return fallbackHtml();
  }

  const providers = selectDop20ProvidersForBounds(bbox);
  if (providers.length === 0) {
    return '';
  }
  if (providers.length > maxInline) {
    return fallbackHtml();
  }

  const parts = providers.map((provider) =>
    formatProviderWebHtml(provider, year),
  );
  return `DOP20: ${parts.join(' · ')}`;
}

export interface FormatDop20PlainAttributionOptions {
  year?: number | undefined;
  locale?: 'de' | 'en' | undefined;
  maxInlineProviders?: number | undefined;
}

/**
 * Formats plain-text DOP20/DOP10 attribution for native map overlays based on
 * the current viewport bbox.
 */
export function formatDop20PlainAttribution(
  bbox: readonly [number, number, number, number] | null | undefined,
  options: FormatDop20PlainAttributionOptions = {},
): string {
  const year = options.year ?? new Date().getUTCFullYear();
  const locale = options.locale ?? 'de';
  const maxInline = options.maxInlineProviders ?? 3;

  const fallbackPlain = (): string =>
    locale === 'en'
      ? `DOP20/DOP10: © GeoBasis-DE / German State Survey Offices (${year}; dl-de/by-2-0, CC BY 4.0, dl-de/zero-2-0; modified)`
      : `DOP20/DOP10: © GeoBasis-DE / Vermessungsverwaltungen der Bundesländer (${year}; dl-de/by-2-0, CC BY 4.0, dl-de/zero-2-0; Daten verändert)`;

  if (!bbox) {
    return fallbackPlain();
  }

  const providers = selectDop20ProvidersForBounds(bbox);
  if (providers.length === 0) {
    return '';
  }
  if (providers.length > maxInline) {
    return fallbackPlain();
  }

  const yearStr = String(year);
  const parts = providers.map((provider) => {
    if (provider.code === 'RP') {
      return `©GeoBasis-DE / LVermGeoRP (${yearStr}, dl-de/by-2-0, http://www.lvermgeo.rlp.de, Daten bearbeitet)`;
    }
    if (provider.code === 'SH') {
      return `© GeoBasis-DE/LVermGeo SH/CC BY 4.0 (${yearStr}, Daten verändert)`;
    }
    if (provider.code === 'MV') {
      return `© GeoBasis-DE/M-V ${yearStr} (https://www.laiv-mv.de, CC BY 4.0, Daten verändert)`;
    }
    const credit = provider.shortCreditTemplate.replace(/\{year\}/g, yearStr);
    return `${credit} (${provider.licenseId}, ${provider.modifiedNote})`;
  });

  return `DOP20: ${parts.join(' · ')}`;
}
