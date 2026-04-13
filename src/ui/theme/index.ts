/**
 * Digital Delta – Design System Tokens
 *
 * Dark theme: flood-resilient colors optimised for field readability.
 *   Primary palette: deep teal (situational awareness) + safety orange (alerts)
 *   Surface hierarchy: near-black → glass layers → card surfaces
 */

export const Colors = {
  // ── Backgrounds ──────────────────────────────────────────────────────
  /** Main app background */
  bgBase: '#050D14',
  /** Slightly lighter layer (cards, panels) */
  bgSurface: '#0C1825',
  /** Glassmorphic card background (semi-transparent) */
  bgGlass: 'rgba(12, 24, 37, 0.72)',
  /** Elevated glass (modals, bottom sheet) */
  bgGlassElevated: 'rgba(18, 34, 52, 0.88)',

  // ── Teal (primary) ────────────────────────────────────────────────────
  tealDark: '#0A3040',
  teal: '#0F6E8C',
  tealMid: '#1A8FA8',
  tealLight: '#4EC9E0',
  tealFaint: 'rgba(15, 110, 140, 0.18)',

  // ── Orange (accent / alert) ───────────────────────────────────────────
  orangeDark: '#7A2E00',
  orange: '#FF6B35',
  orangeLight: '#FFB347',
  orangeFaint: 'rgba(255, 107, 53, 0.18)',

  // ── Semantic states ──────────────────────────────────────────────────
  verified: '#2ECC71',
  verifiedFaint: 'rgba(46, 204, 113, 0.15)',
  conflict: '#FF6B35',
  conflictFaint: 'rgba(255, 107, 53, 0.18)',
  syncing: '#4EC9E0',
  syncingFaint: 'rgba(78, 201, 224, 0.18)',
  offline: '#546E7A',
  offlineFaint: 'rgba(84, 110, 122, 0.18)',

  // ── Category ─────────────────────────────────────────────────────────
  catMedical: '#FF5252',
  catFood: '#FFD54F',
  catWater: '#40C4FF',
  catShelter: '#69F0AE',
  catEquipment: '#CE93D8',

  // ── Text ─────────────────────────────────────────────────────────────
  textPrimary: '#E8F4F8',
  textSecondary: '#8DB8CB',
  textMuted: '#4A6572',
  textInverse: '#050D14',

  // ── Border / chrome ──────────────────────────────────────────────────
  border: 'rgba(78, 201, 224, 0.12)',
  borderFocus: 'rgba(78, 201, 224, 0.45)',
  borderWarn: 'rgba(255, 107, 53, 0.45)',

  // ── Misc ─────────────────────────────────────────────────────────────
  shadow: 'rgba(0, 0, 0, 0.65)',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const Typography = {
  fontSizeXs: 10,
  fontSizeSm: 12,
  fontSizeMd: 14,
  fontSizeLg: 16,
  fontSizeXl: 20,
  fontSizeXxl: 24,
  fontSizeDisplay: 28,

  lineHeightTight: 1.2,
  lineHeightNormal: 1.5,
  lineHeightRelaxed: 1.75,

  fontWeightNormal: '400' as const,
  fontWeightMedium: '500' as const,
  fontWeightSemibold: '600' as const,
  fontWeightBold: '700' as const,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const Radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

export const Shadows = {
  card: {
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 8,
  },
  glow: {
    shadowColor: Colors.tealLight,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

/** Category → brand color mapping */
export const CATEGORY_COLOR: Record<string, string> = {
  Medical: Colors.catMedical,
  Food: Colors.catFood,
  Water: Colors.catWater,
  Shelter: Colors.catShelter,
  Equipment: Colors.catEquipment,
};

/** System state → visual properties */
export const STATE_META = {
  offline: {
    label: 'Offline',
    color: Colors.textSecondary,
    bg: Colors.offlineFaint,
    dot: Colors.offline,
    border: Colors.border,
  },
  syncing: {
    label: 'Syncing…',
    color: Colors.tealLight,
    bg: Colors.syncingFaint,
    dot: Colors.syncing,
    border: Colors.borderFocus,
  },
  conflict: {
    label: 'Conflict Detected',
    color: Colors.orange,
    bg: Colors.conflictFaint,
    dot: Colors.conflict,
    border: Colors.borderWarn,
  },
  verified: {
    label: 'Verified',
    color: Colors.verified,
    bg: Colors.verifiedFaint,
    dot: Colors.verified,
    border: 'rgba(46, 204, 113, 0.35)',
  },
} as const;

export type SystemState = keyof typeof STATE_META;
