// SPDX-License-Identifier: MPL-2.0
// Copyright (C) 2026 Unseal Contributors

import type { TextStyle } from 'react-native';
import type { BrandingConfig, SurfaceType } from '@entsiegelung/shared';

export type ViewportTier = 'compact' | 'medium' | 'expanded';
export type ColorScheme = 'light' | 'dark';
export type ThemePreference = 'system' | 'light' | 'dark';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function resolveColorScheme(
  preference: ThemePreference,
  systemScheme?: ColorScheme | 'unspecified' | null,
): ColorScheme {
  if (preference === 'light' || preference === 'dark') {
    return preference;
  }
  return systemScheme === 'dark' ? 'dark' : 'light';
}

export interface ResponsiveLayout {
  readonly width: number;
  readonly height: number;
  readonly tier: ViewportTier;
  readonly isCompact: boolean;
  readonly isDocked: boolean;
  readonly dockWidth: number;
  readonly modalMaxWidth: number;
  readonly sheetMaxHeightPx: number;
  readonly drawingSheetMaxHeightPx: number;
}

export const BREAKPOINTS = {
  mediumMinWidth: 768,
  expandedMinWidth: 1080,
} as const;

export function deriveResponsiveLayout(
  rawWidth: number,
  rawHeight: number,
): ResponsiveLayout {
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 390;
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 844;

  const tier: ViewportTier =
    width >= BREAKPOINTS.expandedMinWidth
      ? 'expanded'
      : width >= BREAKPOINTS.mediumMinWidth
        ? 'medium'
        : 'compact';

  const isCompact = tier === 'compact';
  const isDocked = !isCompact;
  const dockWidth = tier === 'expanded' ? 404 : 368;
  const modalMaxWidth = isCompact ? Math.max(320, width - 20) : 448;

  const usableStageHeight = Math.max(320, height - (isCompact ? 116 : 92));
  const sheetMaxHeightPx = isCompact
    ? Math.round(Math.min(480, Math.max(280, height * 0.55)))
    : Math.round(usableStageHeight - 28);
  const drawingSheetMaxHeightPx = isCompact
    ? Math.round(Math.min(430, Math.max(260, height * 0.5)))
    : Math.round(usableStageHeight - 28);

  return {
    width,
    height,
    tier,
    isCompact,
    isDocked,
    dockWidth,
    modalMaxWidth,
    sheetMaxHeightPx,
    drawingSheetMaxHeightPx,
  };
}

export function formatRecoveryCodeBlocks(code: string): string {
  const cleaned = code.replace(/[-\s]/g, '').toUpperCase();
  if (cleaned.length === 0) {
    return '';
  }
  const groups: string[] = [];
  for (let i = 0; i < cleaned.length; i += 4) {
    groups.push(cleaned.slice(i, i + 4));
  }
  return groups.join('-');
}

export interface ThemePalette {
  readonly bgGround: string;
  readonly bgSurface: string;
  readonly bgSubtle: string;
  readonly bgRecessed: string;
  readonly bgTinted: string;
  readonly bgScrim: string;
  readonly bgMapCanvas: string;
  readonly bgFloatingPill: string;

  readonly inkPrimary: string;
  readonly inkSecondary: string;
  readonly inkMuted: string;
  readonly inkOnAccent: string;

  readonly accentPrimary: string;
  readonly accentPrimaryStrong: string;
  readonly accentDisabled: string;

  readonly borderSubtle: string;
  readonly borderStrong: string;
  readonly borderAccent: string;

  readonly positiveBg: string;
  readonly positiveBorder: string;
  readonly positiveText: string;
  readonly positiveDot: string;

  readonly neutralBg: string;
  readonly neutralBorder: string;
  readonly neutralText: string;
  readonly neutralDot: string;

  readonly dangerBg: string;
  readonly dangerBorder: string;
  readonly dangerSolid: string;
  readonly dangerText: string;
  readonly dangerDot: string;

  readonly infoBg: string;
  readonly infoBorder: string;
  readonly infoText: string;

  readonly inProgressBg: string;
  readonly inProgressBorder: string;
  readonly inProgressSolid: string;
  readonly inProgressText: string;
  readonly inProgressDot: string;

  readonly finishedBg: string;
  readonly finishedBorder: string;
  readonly finishedSolid: string;
  readonly finishedText: string;
  readonly finishedDot: string;
}

export const LIGHT_PALETTE: ThemePalette = {
  // Mineral sage & stone-paper daylight surfaces
  bgGround: '#EFF3F0',
  bgSurface: '#FFFFFF',
  bgSubtle: '#F5F8F6',
  bgRecessed: '#E8EEEA',
  bgTinted: '#E6F2EC',
  bgScrim: 'rgba(14, 25, 19, 0.54)',
  bgMapCanvas: '#DFE7E2',
  bgFloatingPill: 'rgba(255, 255, 255, 0.94)',

  // High-contrast surveyor ink (all >= 4.5:1 on light surfaces)
  inkPrimary: '#122019',
  inkSecondary: '#36493F',
  inkMuted: '#4E6258',
  inkOnAccent: '#FFFFFF',

  // Primary permeable botanical emerald
  accentPrimary: '#176642',
  accentPrimaryStrong: '#104D31',
  accentDisabled: '#93AFA1',

  // Borders (hairline & structural)
  borderSubtle: '#CFDAD3',
  borderStrong: '#AEC0B5',
  borderAccent: '#8CC0A6',

  // Semantic & Community Score feedback
  positiveBg: '#E4F3EC',
  positiveBorder: '#9BCBB2',
  positiveText: '#115234',
  positiveDot: '#1F7A4C',

  neutralBg: '#FBF1DF',
  neutralBorder: '#DEC18E',
  neutralText: '#6A4006',
  neutralDot: '#C87D1A',

  dangerBg: '#FCEBEC',
  dangerBorder: '#DF9FA3',
  dangerSolid: '#AC2127',
  dangerText: '#8A1C21',
  dangerDot: '#C44536',

  infoBg: '#E9F1F8',
  infoBorder: '#B9CFE4',
  infoText: '#194064',

  inProgressBg: '#DBEAFE',
  inProgressBorder: '#93C5FD',
  inProgressSolid: '#1D4ED8',
  inProgressText: '#1E40AF',
  inProgressDot: '#2563EB',

  finishedBg: '#CCFBF1',
  finishedBorder: '#5EEAD4',
  finishedSolid: '#0D9488',
  finishedText: '#0F766E',
  finishedDot: '#0D9488',
} as const;

export const DARK_PALETTE: ThemePalette = {
  // Nocturnal mineral-sage & botanical slate surfaces
  bgGround: '#0F1613',
  bgSurface: '#16201B',
  bgSubtle: '#1D2923',
  bgRecessed: '#121A16',
  bgTinted: '#193126',
  bgScrim: 'rgba(4, 9, 7, 0.72)',
  bgMapCanvas: '#0C1210',
  bgFloatingPill: 'rgba(22, 32, 27, 0.94)',

  // High-contrast light ink (all >= 5.9:1 on dark surfaces)
  inkPrimary: '#ECF3EF',
  inkSecondary: '#B7C7BE',
  inkMuted: '#93A89D',
  inkOnAccent: '#062115',

  // Luminous botanical emerald (all >= 6.1:1 with inkOnAccent & >= 6.9:1 on dark surfaces)
  accentPrimary: '#34C785',
  accentPrimaryStrong: '#28B073',
  accentDisabled: '#587769',

  // Borders (hairline & structural)
  borderSubtle: '#26352D',
  borderStrong: '#394D42',
  borderAccent: '#2D6E51',

  // Semantic & Community Score feedback
  positiveBg: '#132E22',
  positiveBorder: '#255D43',
  positiveText: '#6EE7B7',
  positiveDot: '#34D399',

  neutralBg: '#2D2210',
  neutralBorder: '#6B4E1B',
  neutralText: '#FCD34D',
  neutralDot: '#F59E0B',

  dangerBg: '#311518',
  dangerBorder: '#70262C',
  dangerSolid: '#F87171',
  dangerText: '#FCA5A5',
  dangerDot: '#F87171',

  infoBg: '#132438',
  infoBorder: '#264B73',
  infoText: '#93C5FD',

  inProgressBg: '#142642',
  inProgressBorder: '#2563EB',
  inProgressSolid: '#60A5FA',
  inProgressText: '#93C5FD',
  inProgressDot: '#60A5FA',

  finishedBg: '#112E2B',
  finishedBorder: '#0D9488',
  finishedSolid: '#2DD4BF',
  finishedText: '#5EEAD4',
  finishedDot: '#2DD4BF',
} as const;

export const PALETTE = LIGHT_PALETTE;

export type BrandAccentOverrides = Pick<
  BrandingConfig,
  'accentColor' | 'accentDarkColor'
>;

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

function pickContrastingInk(
  backgroundHex: string,
  darkInk: string,
  lightInk: string,
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

export function deriveBrandedPalette(
  colorScheme: ColorScheme = 'light',
  branding?: Partial<BrandAccentOverrides> | null,
): ThemePalette {
  const base = colorScheme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
  if (!branding) {
    return base;
  }
  const cleanLight =
    branding.accentColor && parseHexRgb(branding.accentColor)
      ? branding.accentColor.trim().toLowerCase()
      : null;
  const cleanDark =
    branding.accentDarkColor && parseHexRgb(branding.accentDarkColor)
      ? branding.accentDarkColor.trim().toLowerCase()
      : null;

  if (colorScheme === 'light') {
    if (!cleanLight) {
      return base;
    }
    return {
      ...base,
      accentPrimary: cleanLight,
      accentPrimaryStrong: mixHex(cleanLight, '#000000', 0.22),
      accentDisabled: mixHex(cleanLight, base.borderSubtle, 0.56),
      borderAccent: mixHex(cleanLight, '#ffffff', 0.45),
      bgTinted: mixHex(cleanLight, '#ffffff', 0.88),
      inkOnAccent: pickContrastingInk(cleanLight, '#0b1510', '#ffffff'),
    };
  }

  const effectiveDarkAccent =
    cleanDark ?? (cleanLight ? mixHex(cleanLight, '#ffffff', 0.38) : null);
  if (!effectiveDarkAccent) {
    return base;
  }
  return {
    ...base,
    accentPrimary: effectiveDarkAccent,
    accentPrimaryStrong: mixHex(effectiveDarkAccent, '#000000', 0.14),
    accentDisabled: mixHex(effectiveDarkAccent, base.borderSubtle, 0.62),
    borderAccent: mixHex(effectiveDarkAccent, base.bgSurface, 0.45),
    bgTinted: mixHex(effectiveDarkAccent, base.bgGround, 0.82),
    inkOnAccent: pickContrastingInk(effectiveDarkAccent, '#062115', '#ffffff'),
  };
}

export function getPalette(
  colorScheme: ColorScheme = 'light',
  branding?: Partial<BrandAccentOverrides> | null,
): ThemePalette {
  return deriveBrandedPalette(colorScheme, branding);
}

export const SURFACE_SWATCHES: Record<
  SurfaceType,
  { readonly color: string; readonly code: string }
> = {
  asphalt: { color: '#333D3A', code: 'ASP' },
  concrete: { color: '#707D78', code: 'CON' },
  pavers: { color: '#8A5A36', code: 'PAV' },
  other: { color: '#556650', code: 'MIX' },
};

export const DARK_SURFACE_SWATCHES: Record<
  SurfaceType,
  { readonly color: string; readonly code: string }
> = {
  asphalt: { color: '#4B5955', code: 'ASP' },
  concrete: { color: '#8A9892', code: 'CON' },
  pavers: { color: '#B4794C', code: 'PAV' },
  other: { color: '#6E8368', code: 'MIX' },
};

export function getSurfaceSwatches(
  colorScheme: ColorScheme = 'light',
): Record<SurfaceType, { readonly color: string; readonly code: string }> {
  return colorScheme === 'dark' ? DARK_SURFACE_SWATCHES : SURFACE_SWATCHES;
}

export const RADII = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  sheet: 20,
  pill: 999,
} as const;

export const MONO_FONT_FAMILY = 'monospace';

export const TABULAR_NUMS_STYLE: TextStyle = {
  fontVariant: ['tabular-nums'],
};
