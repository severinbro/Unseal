// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Unseal Contributors

export interface ServerBrandColors {
  readonly accentLight: string;
  readonly buttonLight: string;
  readonly buttonLightHover: string;
  readonly brandBgLight: string;
  readonly inkOnAccentLight: string;
  readonly accentDark: string;
  readonly buttonDarkHover: string;
  readonly brandBgDark: string;
  readonly brandTextDark: string;
  readonly inkOnAccentDark: string;
}

const DEFAULT_SERVER_BRAND_COLORS: ServerBrandColors = {
  accentLight: '#176642',
  buttonLight: '#1f6f4a',
  buttonLightHover: '#18583a',
  brandBgLight: '#eaf5ef',
  inkOnAccentLight: '#ffffff',
  accentDark: '#34c785',
  buttonDarkHover: '#28b073',
  brandBgDark: '#193126',
  brandTextDark: '#6ee7b7',
  inkOnAccentDark: '#062115',
};

interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function parseHexRgb(hex: string): RgbColor | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  return {
    r: Number.parseInt(match[1], 16),
    g: Number.parseInt(match[2], 16),
    b: Number.parseInt(match[3], 16),
  };
}

function rgbToHex({ r, g, b }: RgbColor): string {
  const clamp = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function mixHex(baseHex: string, targetHex: string, ratio: number): string {
  const a = parseHexRgb(baseHex);
  const b = parseHexRgb(targetHex);
  if (!a || !b) {
    return baseHex;
  }
  const t = Math.max(0, Math.min(1, ratio));
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

function relativeLuminance(rgb: RgbColor): number {
  const linearize = (channel: number): number => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linearize(rgb.r) +
    0.7152 * linearize(rgb.g) +
    0.0722 * linearize(rgb.b)
  );
}

function contrastRatio(lumA: number, lumB: number): number {
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function pickContrastingInk(
  backgroundHex: string,
  darkInk: string = '#0b1510',
  lightInk: string = '#ffffff',
): string {
  const bg = parseHexRgb(backgroundHex);
  const dark = parseHexRgb(darkInk);
  const light = parseHexRgb(lightInk);
  if (!bg || !dark || !light) {
    return lightInk;
  }
  const bgLum = relativeLuminance(bg);
  const darkContrast = contrastRatio(bgLum, relativeLuminance(dark));
  const lightContrast = contrastRatio(bgLum, relativeLuminance(light));
  return lightContrast >= darkContrast ? lightInk : darkInk;
}

export function deriveServerBrandColors(
  accentColor?: string | null,
  accentDarkColor?: string | null,
): ServerBrandColors {
  const cleanLight =
    accentColor && parseHexRgb(accentColor) ? accentColor.trim().toLowerCase() : null;
  const cleanDark =
    accentDarkColor && parseHexRgb(accentDarkColor)
      ? accentDarkColor.trim().toLowerCase()
      : null;

  if (!cleanLight && !cleanDark) {
    return DEFAULT_SERVER_BRAND_COLORS;
  }

  const accentLight = cleanLight ?? DEFAULT_SERVER_BRAND_COLORS.accentLight;
  const buttonLight = cleanLight ?? DEFAULT_SERVER_BRAND_COLORS.buttonLight;
  const buttonLightHover = cleanLight
    ? mixHex(cleanLight, '#000000', 0.2)
    : DEFAULT_SERVER_BRAND_COLORS.buttonLightHover;
  const brandBgLight = cleanLight
    ? mixHex(cleanLight, '#ffffff', 0.88)
    : DEFAULT_SERVER_BRAND_COLORS.brandBgLight;
  const inkOnAccentLight = cleanLight
    ? pickContrastingInk(buttonLight)
    : DEFAULT_SERVER_BRAND_COLORS.inkOnAccentLight;

  const accentDark =
    cleanDark ??
    (cleanLight ? mixHex(cleanLight, '#ffffff', 0.38) : DEFAULT_SERVER_BRAND_COLORS.accentDark);
  const hasCustomDark = cleanDark !== null || cleanLight !== null;
  const buttonDarkHover = hasCustomDark
    ? mixHex(accentDark, '#000000', 0.14)
    : DEFAULT_SERVER_BRAND_COLORS.buttonDarkHover;
  const brandBgDark = hasCustomDark
    ? mixHex(accentDark, '#0f1613', 0.82)
    : DEFAULT_SERVER_BRAND_COLORS.brandBgDark;
  const brandTextDark = hasCustomDark
    ? mixHex(accentDark, '#ffffff', 0.35)
    : DEFAULT_SERVER_BRAND_COLORS.brandTextDark;
  const inkOnAccentDark = hasCustomDark
    ? pickContrastingInk(accentDark, '#062115', '#ffffff')
    : DEFAULT_SERVER_BRAND_COLORS.inkOnAccentDark;

  return {
    accentLight,
    buttonLight,
    buttonLightHover,
    brandBgLight,
    inkOnAccentLight,
    accentDark,
    buttonDarkHover,
    brandBgDark,
    brandTextDark,
    inkOnAccentDark,
  };
}
