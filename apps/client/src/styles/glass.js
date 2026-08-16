/**
 * DropLink design tokens — glassmorphism on a dark slate base.
 *
 * All components import from here. Changing a value here changes it everywhere.
 *
 * Palette rationale:
 *   Base:    #0a0f1e — deep navy, gives glass panels visual depth
 *   Surface: rgba(255,255,255,0.06) — translucent white for glass panels
 *   Border:  rgba(255,255,255,0.12) — subtle glass edge
 *   Blur:    16px — standard backdrop-filter value; falls back gracefully
 *   Accent:  #6366f1 (indigo-500) — primary action colour
 *   Glows are built with box-shadow + the accent at low opacity
 */

// ─── Base palette ─────────────────────────────────────────────────────────────

export const color = {
  // Page / background layers
  bg:            '#0a0f1e',
  bgDeep:        '#060912',
  bgOrb1:        'rgba(99, 102, 241, 0.15)',  // indigo orb
  bgOrb2:        'rgba(139, 92, 246, 0.10)',  // violet orb

  // Glass panel
  glass:         'rgba(255, 255, 255, 0.06)',
  glassBorder:   'rgba(255, 255, 255, 0.12)',
  glassHover:    'rgba(255, 255, 255, 0.09)',
  glassActive:   'rgba(255, 255, 255, 0.12)',

  // Text
  textPrimary:   '#f1f5f9',    // slate-100
  textSecondary: '#94a3b8',    // slate-400
  textMuted:     '#475569',    // slate-600

  // Accent (primary actions)
  accent:        '#6366f1',    // indigo-500
  accentHover:   '#818cf8',    // indigo-400
  accentGlow:    'rgba(99, 102, 241, 0.35)',

  // State colours
  success:       '#22c55e',    // green-500
  successGlow:   'rgba(34, 197, 94, 0.30)',
  warning:       '#f59e0b',    // amber-500
  warningGlow:   'rgba(245, 158, 11, 0.30)',
  danger:        '#ef4444',    // red-500
  dangerGlow:    'rgba(239, 68, 68, 0.30)',
  info:          '#38bdf8',    // sky-400
  infoGlow:      'rgba(56, 189, 248, 0.30)',
  mismatch:      '#f97316',    // orange-500
  mismatchGlow:  'rgba(249, 115, 22, 0.30)',
};

// ─── Typography ───────────────────────────────────────────────────────────────

export const font = {
  family: "'Inter', system-ui, -apple-system, sans-serif",
  mono:   "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
  size: {
    xs:   11,
    sm:   12,
    base: 14,
    md:   15,
    lg:   18,
    xl:   24,
    hero: 36,
  },
  weight: {
    normal:    400,
    medium:    500,
    semibold:  600,
    bold:      700,
    extrabold: 800,
  },
};

// ─── Spacing ──────────────────────────────────────────────────────────────────

export const space = {
  1:  4,
  2:  8,
  3:  12,
  4:  16,
  5:  20,
  6:  24,
  8:  32,
  10: 40,
  12: 48,
};

// ─── Radius ───────────────────────────────────────────────────────────────────

export const radius = {
  sm:   6,
  md:   10,
  lg:   16,
  xl:   20,
  full: 9999,
};

// ─── Shadows / glows ─────────────────────────────────────────────────────────

export const shadow = {
  glass:        '0 8px 32px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.08)',
  glassElevated:'0 16px 48px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.10)',
  accent:       `0 0 24px ${color.accentGlow}`,
  success:      `0 0 20px ${color.successGlow}`,
  warning:      `0 0 20px ${color.warningGlow}`,
  danger:       `0 0 20px ${color.dangerGlow}`,
  none:         'none',
};

// ─── Transitions ─────────────────────────────────────────────────────────────

export const transition = {
  fast:    'all 0.12s ease',
  base:    'all 0.18s ease',
  slow:    'all 0.28s ease',
  spring:  'all 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
};

// ─── Glass panel mixin ────────────────────────────────────────────────────────

/** Base glass panel style object — spread into any component's inline style. */
export const glassPanel = {
  background:           color.glass,
  backdropFilter:       'blur(16px) saturate(180%)',
  WebkitBackdropFilter: 'blur(16px) saturate(180%)',
  border:               `1px solid ${color.glassBorder}`,
  boxShadow:            shadow.glass,
};

// ─── State → colour mapping ───────────────────────────────────────────────────
// Used consistently across StatusPanel and TransferCard.

import { CONNECTION_STATUS } from '../hooks/usePeerConnection.js';
import { TRANSFER_STATUS } from '../hooks/transferProtocol.js';

export const connStateColor = {
  [CONNECTION_STATUS.IDLE]:              color.textMuted,
  [CONNECTION_STATUS.CONNECTING]:        color.warning,
  [CONNECTION_STATUS.WAITING_FOR_PEER]:  color.info,
  [CONNECTION_STATUS.NEGOTIATING]:       color.warning,
  [CONNECTION_STATUS.CONNECTED]:         color.success,
  [CONNECTION_STATUS.RECONNECTING]:      color.warning,
  [CONNECTION_STATUS.PEER_DISCONNECTED]: color.danger,
  [CONNECTION_STATUS.ROOM_FULL]:         color.danger,
  [CONNECTION_STATUS.INVALID_ROOM]:      color.danger,
  [CONNECTION_STATUS.ICE_FAILED]:        color.danger,
  [CONNECTION_STATUS.SIGNALING_ERROR]:   color.danger,
};

export const connStateGlow = {
  [CONNECTION_STATUS.IDLE]:              shadow.none,
  [CONNECTION_STATUS.CONNECTING]:        shadow.warning,
  [CONNECTION_STATUS.WAITING_FOR_PEER]:  `0 0 20px ${color.infoGlow}`,
  [CONNECTION_STATUS.NEGOTIATING]:       shadow.warning,
  [CONNECTION_STATUS.CONNECTED]:         shadow.success,
  [CONNECTION_STATUS.RECONNECTING]:      shadow.warning,
  [CONNECTION_STATUS.PEER_DISCONNECTED]: shadow.danger,
  [CONNECTION_STATUS.ROOM_FULL]:         shadow.danger,
  [CONNECTION_STATUS.INVALID_ROOM]:      shadow.danger,
  [CONNECTION_STATUS.ICE_FAILED]:        shadow.danger,
  [CONNECTION_STATUS.SIGNALING_ERROR]:   shadow.danger,
};

export const txStateColor = {
  [TRANSFER_STATUS.PENDING]:            color.textMuted,
  [TRANSFER_STATUS.TRANSFERRING]:       color.accent,
  [TRANSFER_STATUS.PAUSED]:             color.warning,
  [TRANSFER_STATUS.RESUMING]:           color.info,
  [TRANSFER_STATUS.COMPLETE]:           color.success,
  [TRANSFER_STATUS.CANCELLED]:          color.textMuted,
  [TRANSFER_STATUS.INTEGRITY_MISMATCH]: color.mismatch,
  [TRANSFER_STATUS.ERROR]:              color.danger,
  [TRANSFER_STATUS.INTERRUPTED]:        color.danger,
};
