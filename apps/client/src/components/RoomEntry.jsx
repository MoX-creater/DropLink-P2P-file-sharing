/**
 * RoomEntry — create / join room controls.
 *
 * Renders contextually based on connection state:
 *   IDLE / terminal states  → create + join form
 *   Busy (connecting etc.)  → spinner + cancel option
 *   CONNECTED               → nothing (handled by parent)
 */

import { useState } from 'react';
import { CONNECTION_STATUS } from '../hooks/usePeerConnection.js';
import {
  color, font, space, radius, glassPanel, transition, shadow,
} from '../styles/glass.js';

// States where we're actively working — show spinner instead of form.
const BUSY_STATES = new Set([
  CONNECTION_STATUS.CONNECTING,
  CONNECTION_STATUS.WAITING_FOR_PEER,
  CONNECTION_STATUS.NEGOTIATING,
  CONNECTION_STATUS.RECONNECTING,
]);

// Terminal error states — show the form again with contextual hint.
const ERROR_STATES = new Set([
  CONNECTION_STATUS.PEER_DISCONNECTED,
  CONNECTION_STATUS.ROOM_FULL,
  CONNECTION_STATUS.INVALID_ROOM,
  CONNECTION_STATUS.ICE_FAILED,
  CONNECTION_STATUS.SIGNALING_ERROR,
]);

const HINT = {
  [CONNECTION_STATUS.PEER_DISCONNECTED]: 'Your peer disconnected. Create a new room or rejoin with the same code.',
  [CONNECTION_STATUS.ROOM_FULL]:         'That room already has two people. Ask your peer for a different code.',
  [CONNECTION_STATUS.INVALID_ROOM]:      'Room code not recognised. Check for typos — codes are 6 uppercase characters.',
  [CONNECTION_STATUS.ICE_FAILED]:        'Connection failed to establish. Try again; this sometimes resolves on retry.',
  [CONNECTION_STATUS.SIGNALING_ERROR]:   'Lost contact with the signaling server. Check your network and try again.',
};

const BUSY_LABEL = {
  [CONNECTION_STATUS.CONNECTING]:       'Connecting to signaling server…',
  [CONNECTION_STATUS.WAITING_FOR_PEER]: 'Room created — share the code above with your peer.',
  [CONNECTION_STATUS.NEGOTIATING]:      'Establishing peer connection…',
  [CONNECTION_STATUS.RECONNECTING]:     'Connection dropped — attempting to reconnect…',
};

export function RoomEntry({ status, onCreateRoom, onJoinRoom, onDisconnect }) {
  const [joinInput, setJoinInput] = useState('');

  const isIdle      = status === CONNECTION_STATUS.IDLE;
  const isBusy      = BUSY_STATES.has(status);
  const isError     = ERROR_STATES.has(status);
  const isConnected = status === CONNECTION_STATUS.CONNECTED;

  if (isConnected) return null;

  function handleJoin() {
    const id = joinInput.trim().toUpperCase();
    if (id.length >= 4) onJoinRoom(id);
  }

  return (
    <div style={{ ...glassPanel, borderRadius: radius.lg, padding: space[6], marginBottom: space[5] }}>

      {/* Contextual hint for error states */}
      {isError && HINT[status] && (
        <p style={{
          margin: `0 0 ${space[5]}px`,
          padding: `${space[3]}px ${space[4]}px`,
          background: 'rgba(239,68,68,0.08)',
          border: `1px solid rgba(239,68,68,0.20)`,
          borderRadius: radius.md,
          fontSize: font.size.sm,
          color: color.textSecondary,
          lineHeight: 1.6,
        }}>
          {HINT[status]}
        </p>
      )}

      {/* Busy state */}
      {isBusy && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[4], alignItems: 'flex-start' }}>
          <p style={{ margin: 0, fontSize: font.size.sm, color: color.textSecondary, lineHeight: 1.6 }}>
            {BUSY_LABEL[status]}
          </p>
          {status !== CONNECTION_STATUS.WAITING_FOR_PEER && (
            <button onClick={onDisconnect} style={dangerBtnStyle}>
              Cancel
            </button>
          )}
          {status === CONNECTION_STATUS.WAITING_FOR_PEER && (
            <button onClick={onDisconnect} style={ghostBtnStyle}>
              Cancel and start over
            </button>
          )}
        </div>
      )}

      {/* Idle or error — show the form */}
      {(isIdle || isError) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: space[4] }}>
          <div style={{ display: 'flex', gap: space[3] }}>
            <button onClick={onCreateRoom} style={primaryBtnStyle}>
              Create room
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
            <div style={{ flex: 1, height: 1, background: color.glassBorder }} />
            <span style={{ fontSize: font.size.xs, color: color.textMuted }}>or join existing</span>
            <div style={{ flex: 1, height: 1, background: color.glassBorder }} />
          </div>

          <div style={{ display: 'flex', gap: space[3] }}>
            <input
              style={inputStyle}
              placeholder="Room code (e.g. ABC123)"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              maxLength={64}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              onClick={handleJoin}
              disabled={joinInput.trim().length < 4}
              style={joinInput.trim().length >= 4 ? primaryBtnStyle : disabledBtnStyle}
            >
              Join
            </button>
          </div>

          {isError && (
            <button onClick={onDisconnect} style={ghostBtnStyle}>
              Clear and start over
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Button / input styles ────────────────────────────────────────────────────

const primaryBtnStyle = {
  padding:      `${space[3]}px ${space[5]}px`,
  background:   `linear-gradient(135deg, #6366f1, #8b5cf6)`,
  border:       'none',
  borderRadius: radius.md,
  color:        '#fff',
  fontSize:     font.size.base,
  fontWeight:   font.weight.semibold,
  cursor:       'pointer',
  transition:   transition.base,
  boxShadow:    shadow.accent,
  flexShrink:   0,
};

const dangerBtnStyle = {
  ...primaryBtnStyle,
  background: `linear-gradient(135deg, #ef4444, #dc2626)`,
  boxShadow:  shadow.danger,
};

const ghostBtnStyle = {
  padding:      `${space[2]}px ${space[4]}px`,
  background:   'transparent',
  border:       `1px solid ${color.glassBorder}`,
  borderRadius: radius.md,
  color:        color.textSecondary,
  fontSize:     font.size.sm,
  cursor:       'pointer',
  transition:   transition.fast,
};

const disabledBtnStyle = {
  ...primaryBtnStyle,
  background:  color.glass,
  boxShadow:   'none',
  color:       color.textMuted,
  cursor:      'not-allowed',
  opacity:     0.6,
};

const inputStyle = {
  flex:         1,
  padding:      `${space[3]}px ${space[4]}px`,
  background:   'rgba(255,255,255,0.04)',
  border:       `1px solid ${color.glassBorder}`,
  borderRadius: radius.md,
  color:        color.textPrimary,
  fontSize:     font.size.base,
  fontFamily:   font.mono,
  letterSpacing: '0.08em',
  outline:      'none',
  transition:   transition.fast,
};
