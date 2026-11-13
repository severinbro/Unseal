import type { TextStyle } from 'react-native';
import type { SurfaceType } from '@entsiegelung/shared';

export type ViewportTier = 'compact' | 'medium' | 'expanded';

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

export const PALETTE = {
  // Mineral sage & stone-paper daylight surfaces
  bgGround: '#EFF3F0',
  bgSurface: '#FFFFFF',
  bgSubtle: '#F5F8F6',
  bgRecessed: '#E8EEEA',
  bgTinted: '#E6F2EC',
  bgScrim: 'rgba(14, 25, 19, 0.54)',

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

  finishedBg: '#CCFBF1',
  finishedBorder: '#5EEAD4',
  finishedSolid: '#0D9488',
  finishedText: '#0F766E',
  finishedDot: '#0D9488',
} as const;

export const SURFACE_SWATCHES: Record<
  SurfaceType,
  { readonly color: string; readonly code: string }
> = {
  asphalt: { color: '#333D3A', code: 'ASP' },
  concrete: { color: '#707D78', code: 'CON' },
  pavers: { color: '#8A5A36', code: 'PAV' },
  other: { color: '#556650', code: 'MIX' },
};

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
