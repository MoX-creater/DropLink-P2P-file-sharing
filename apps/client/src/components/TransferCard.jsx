/**
 * TransferCard — one card per active or completed file transfer.
 *
 * Covers every TRANSFER_STATUS value with a distinct designed representation:
 *   pending         — muted, no progress bar
 *   transferring    — animated progress bar + speed readout
 *   paused          — amber tint, progress frozen
 *   resuming        — pulsing bar, "Resuming after reconnect" label
 *   complete        — green glow, checkmark, file size confirmed
 *   cancelled       — muted strikethrough-style
 *   integrity-mismatch — orange warning block + hash snippet
 *   error           — red error block
 *   transfer-interrupted — red block, "reconnecting" or "failed" sub-label
 */

import { TRANSFER_STATUS, formatBytes } from '../hooks/transferProtocol.js';
import {
  color, font, space, radius, glassPanel, transition, shadow,
  txStateColor,
} from '../styles/glass.js';

// ─── Labels ───────────────────────────────────────────────────────────────────

const TX_LABEL = {
  [TRANSFER_STATUS.PENDING]:            'Pending',
  [TRANSFER_STATUS.TRANSFERRING]:       'Transferring',
  [TRANSFER_STATUS.PAUSED]:             'Paused',
  [TRANSFER_STATUS.RESUMING]:           'Resuming…',
  [TRANSFER_STATUS.COMPLETE]:           'Complete',
  [TRANSFER_STATUS.CANCELLED]:          'Cancelled',
  [TRANSFER_STATUS.INTEGRITY_MISMATCH]: 'Integrity mismatch',
  [TRANSFER_STATUS.ERROR]:              'Error',
  [TRANSFER_STATUS.INTERRUPTED]:        'Interrupted',
};

const DIR_ICON = { send: '↑', receive: '↓' };
const DIR_LABEL = { send: 'Sending', receive: 'Receiving' };

// States with an active progress bar.
const ACTIVE = new Set([
  TRANSFER_STATUS.TRANSFERRING,
  TRANSFER_STATUS.PAUSED,
  TRANSFER_STATUS.RESUMING,
]);

export function TransferCard({ transfer: t, onCancel, onPause, onResume }) {
  const stateColor = txStateColor[t.status] ?? color.textMuted;
  const pct        = Math.round(t.progress * 100);
  const isActive   = ACTIVE.has(t.status);
  const canPause   = t.direction === 'send' && t.status === TRANSFER_STATUS.TRANSFERRING;
  const canResume  = t.direction === 'send' && t.status === TRANSFER_STATUS.PAUSED;
  const canCancel  = isActive;

  const borderColor = t.status === TRANSFER_STATUS.COMPLETE
    ? `rgba(34, 197, 94, 0.25)`
    : t.status === TRANSFER_STATUS.INTEGRITY_MISMATCH
      ? `rgba(249, 115, 22, 0.30)`
      : t.status === TRANSFER_STATUS.INTERRUPTED || t.status === TRANSFER_STATUS.ERROR
        ? `rgba(239, 68, 68, 0.20)`
        : color.glassBorder;

  return (
    <div style={{
      ...glassPanel,
      borderRadius: radius.lg,
      padding:      `${space[4]}px ${space[5]}px`,
      marginBottom: space[3],
      border:       `1px solid ${borderColor}`,
      transition:   transition.slow,
    }}>

      {/* Header row: filename + direction + status badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: space[3], marginBottom: space[3] }}>
        {/* Direction icon */}
        <span style={{
          width:         28,
          height:        28,
          borderRadius:  radius.sm,
          background:    `rgba(255,255,255,0.06)`,
          border:        `1px solid ${color.glassBorder}`,
          display:       'flex',
          alignItems:    'center',
          justifyContent:'center',
          fontSize:      font.size.md,
          color:         stateColor,
          flexShrink:    0,
        }}>
          {DIR_ICON[t.direction]}
        </span>

        {/* Filename */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <p style={{
            margin:       0,
            fontSize:     font.size.base,
            fontWeight:   font.weight.semibold,
            color:        t.status === TRANSFER_STATUS.CANCELLED ? color.textMuted : color.textPrimary,
            textDecoration: t.status === TRANSFER_STATUS.CANCELLED ? 'line-through' : 'none',
            whiteSpace:   'nowrap',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
          }} title={t.name}>
            {t.name}
          </p>
          <p style={{ margin: `${space[1]}px 0 0`, fontSize: font.size.xs, color: color.textMuted }}>
            {DIR_LABEL[t.direction]} · {formatBytes(t.size)}
          </p>
        </div>

        {/* Status badge */}
        <span style={{
          padding:      `2px ${space[2]}px`,
          borderRadius: radius.full,
          fontSize:     font.size.xs,
          fontWeight:   font.weight.semibold,
          background:   `${stateColor}18`,
          border:       `1px solid ${stateColor}40`,
          color:        stateColor,
          flexShrink:   0,
          whiteSpace:   'nowrap',
        }}>
          {t.status === TRANSFER_STATUS.COMPLETE ? '✓ ' : ''}{TX_LABEL[t.status] ?? t.status}
        </span>
      </div>

      {/* Progress bar (active transfers only) */}
      {isActive && (
        <div style={{ marginBottom: space[3] }}>
          <div style={{
            height:       6,
            background:   'rgba(255,255,255,0.08)',
            borderRadius: radius.full,
            overflow:     'hidden',
          }}>
            <div style={{
              height:     '100%',
              width:      `${pct}%`,
              background: t.status === TRANSFER_STATUS.PAUSED
                ? `linear-gradient(90deg, ${color.warning}, ${color.warningGlow})`
                : t.status === TRANSFER_STATUS.RESUMING
                  ? `linear-gradient(90deg, ${color.info}, ${color.infoGlow})`
                  : `linear-gradient(90deg, ${color.accent}, #8b5cf6)`,
              borderRadius: radius.full,
              transition:   'width 0.3s ease',
              animation:    t.status === TRANSFER_STATUS.RESUMING ? 'droplink-shimmer 1.6s ease infinite' : 'none',
            }} />
          </div>

          {/* Progress details row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: space[1] }}>
            <span style={{ fontSize: font.size.xs, color: color.textMuted }}>
              {formatBytes(t.bytesTransferred)} / {formatBytes(t.size)}
            </span>
            <span style={{ fontSize: font.size.xs, color: color.textMuted }}>
              {t.speedBps > 0 && t.status === TRANSFER_STATUS.TRANSFERRING
                ? `${formatBytes(t.speedBps)}/s · `
                : ''}
              {pct}%
            </span>
          </div>
        </div>
      )}

      {/* Complete: show final size confirmation */}
      {t.status === TRANSFER_STATUS.COMPLETE && (
        <p style={{
          margin:     0,
          fontSize:   font.size.sm,
          color:      color.success,
        }}>
          {t.direction === 'receive' ? 'File saved — ' : 'Sent — '}{formatBytes(t.size)} transferred successfully.
        </p>
      )}

      {/* Resuming: offset info */}
      {t.status === TRANSFER_STATUS.RESUMING && t.resumeOffset > 0 && (
        <p style={{ margin: `${space[2]}px 0 0`, fontSize: font.size.xs, color: color.textSecondary }}>
          Resuming from {formatBytes(t.resumeOffset)}…
        </p>
      )}

      {/* Sink warning */}
      {t.sinkWarning && (
        <div style={{
          marginTop:    space[2],
          padding:      `${space[2]}px ${space[3]}px`,
          background:   'rgba(245,158,11,0.08)',
          border:       `1px solid rgba(245,158,11,0.20)`,
          borderRadius: radius.sm,
          fontSize:     font.size.xs,
          color:        color.warning,
          lineHeight:   1.5,
        }}>
          ⚠ {t.sinkWarning}
        </div>
      )}

      {/* Integrity mismatch detail */}
      {t.status === TRANSFER_STATUS.INTEGRITY_MISMATCH && t.error && (
        <div style={{
          marginTop:    space[2],
          padding:      `${space[3]}px ${space[4]}px`,
          background:   'rgba(249,115,22,0.08)',
          border:       `1px solid rgba(249,115,22,0.25)`,
          borderRadius: radius.md,
          fontSize:     font.size.sm,
          color:        color.mismatch,
          lineHeight:   1.6,
        }}>
          {t.error}
          <br />
          <span style={{ fontSize: font.size.xs, color: color.textMuted, marginTop: 4, display: 'block' }}>
            The file may have been corrupted in transit. Ask the sender to try again.
          </span>
        </div>
      )}

      {/* Error / interrupted detail */}
      {(t.status === TRANSFER_STATUS.ERROR || t.status === TRANSFER_STATUS.INTERRUPTED) && t.error && (
        <div style={{
          marginTop:    space[2],
          padding:      `${space[3]}px ${space[4]}px`,
          background:   'rgba(239,68,68,0.08)',
          border:       `1px solid rgba(239,68,68,0.20)`,
          borderRadius: radius.md,
          fontSize:     font.size.sm,
          color:        color.danger,
          lineHeight:   1.5,
        }}>
          {t.error}
        </div>
      )}

      {/* Action buttons */}
      {(canPause || canResume || canCancel) && (
        <div style={{ display: 'flex', gap: space[2], marginTop: space[3] }}>
          {canPause && (
            <ActionButton onClick={onPause} variant="warning">Pause</ActionButton>
          )}
          {canResume && (
            <ActionButton onClick={onResume} variant="accent">Resume</ActionButton>
          )}
          {canCancel && (
            <ActionButton onClick={onCancel} variant="danger">Cancel</ActionButton>
          )}
        </div>
      )}

      <style>{`
        @keyframes droplink-shimmer {
          0%   { opacity: 1; }
          50%  { opacity: 0.55; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Small action button ──────────────────────────────────────────────────────

function ActionButton({ onClick, children, variant = 'accent' }) {
  const bg = {
    accent:  `linear-gradient(135deg, #6366f1, #8b5cf6)`,
    warning: `linear-gradient(135deg, #f59e0b, #d97706)`,
    danger:  `linear-gradient(135deg, #ef4444, #dc2626)`,
  }[variant];

  return (
    <button
      onClick={onClick}
      style={{
        padding:      `${space[1] + 2}px ${space[3]}px`,
        background:   bg,
        border:       'none',
        borderRadius: radius.sm,
        color:        '#fff',
        fontSize:     font.size.xs,
        fontWeight:   font.weight.semibold,
        cursor:       'pointer',
        transition:   transition.fast,
      }}
    >
      {children}
    </button>
  );
}
