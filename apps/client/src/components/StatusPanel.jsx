/**
 * StatusPanel — the top-of-page connection status display.
 *
 * Shows:
 *   - Animated status dot (pulsing for in-progress states)
 *   - Human-readable status label
 *   - Room ID with copy button (when connected or waiting)
 *   - Subtle glow that matches the current state colour
 */

import { useState } from 'react';
import { CONNECTION_STATUS } from '../hooks/usePeerConnection.js';
import {
  color, font, space, radius, glassPanel, transition,
  connStateColor, connStateGlow,
} from '../styles/glass.js';

// ─── Labels ───────────────────────────────────────────────────────────────────

const LABEL = {
  [CONNECTION_STATUS.IDLE]:              'Not connected',
  [CONNECTION_STATUS.CONNECTING]:        'Connecting…',
  [CONNECTION_STATUS.WAITING_FOR_PEER]:  'Waiting for peer',
  [CONNECTION_STATUS.NEGOTIATING]:       'Negotiating…',
  [CONNECTION_STATUS.CONNECTED]:         'Connected',
  [CONNECTION_STATUS.RECONNECTING]:      'Reconnecting…',
  [CONNECTION_STATUS.PEER_DISCONNECTED]: 'Peer disconnected',
  [CONNECTION_STATUS.ROOM_FULL]:         'Room is full',
  [CONNECTION_STATUS.INVALID_ROOM]:      'Invalid room code',
  [CONNECTION_STATUS.ICE_FAILED]:        'Connection failed',
  [CONNECTION_STATUS.SIGNALING_ERROR]:   'Signaling error',
};

// States where the dot should pulse.
const PULSING = new Set([
  CONNECTION_STATUS.CONNECTING,
  CONNECTION_STATUS.WAITING_FOR_PEER,
  CONNECTION_STATUS.NEGOTIATING,
  CONNECTION_STATUS.RECONNECTING,
]);

export function StatusPanel({ status, roomId, error }) {
  const [copied, setCopied] = useState(false);
  const stateColor = connStateColor[status] ?? color.textMuted;
  const stateGlow  = connStateGlow[status]  ?? 'none';
  const label      = LABEL[status] ?? status;
  const isPulsing  = PULSING.has(status);
  const showRoom   = roomId && (
    status === CONNECTION_STATUS.CONNECTED ||
    status === CONNECTION_STATUS.WAITING_FOR_PEER ||
    status === CONNECTION_STATUS.RECONNECTING
  );

  function handleCopy() {
    navigator.clipboard?.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div style={{ ...glassPanel, borderRadius: radius.lg, padding: `${space[4]}px ${space[6]}px`, marginBottom: space[5] }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
        {/* Status dot */}
        <span style={{
          display:       'block',
          width:         10,
          height:        10,
          borderRadius:  radius.full,
          background:    stateColor,
          boxShadow:     `0 0 8px ${stateColor}`,
          flexShrink:    0,
          animation:     isPulsing ? 'droplink-pulse 1.4s ease-in-out infinite' : 'none',
        }} />

        {/* Label */}
        <span style={{
          fontSize:   font.size.md,
          fontWeight: font.weight.semibold,
          color:      stateColor,
          flex:       1,
        }}>
          {label}
        </span>

        {/* Room ID chip */}
        {showRoom && (
          <button
            onClick={handleCopy}
            title="Click to copy room code"
            style={{
              display:        'flex',
              alignItems:     'center',
              gap:            space[2],
              background:     color.glassActive,
              border:         `1px solid ${color.glassBorder}`,
              borderRadius:   radius.full,
              padding:        `${space[1]}px ${space[3]}px`,
              cursor:         'pointer',
              transition:     transition.fast,
              color:          color.textPrimary,
            }}
          >
            <span style={{ fontFamily: font.mono, fontSize: font.size.sm, letterSpacing: '0.08em' }}>
              {roomId}
            </span>
            <span style={{ fontSize: font.size.xs, color: color.textSecondary }}>
              {copied ? '✓ copied' : 'copy'}
            </span>
          </button>
        )}
      </div>

      {/* Error detail */}
      {error && (
        <p style={{
          margin:     `${space[2]}px 0 0`,
          fontSize:   font.size.sm,
          color:      color.danger,
          lineHeight: 1.5,
        }}>
          {error}
        </p>
      )}

      {/* Keyframe injection — one-time, idempotent */}
      <style>{`
        @keyframes droplink-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
