/**
 * StatusPanel — connection status display matching terminal mockup panel pattern.
 *
 * Header: connection | [status]
 * Row: StatusLED + text description (with clickable room code copy feature)
 */

import { useState } from 'react';
import { CONNECTION_STATUS } from '../hooks/usePeerConnection.js';
import { Panel } from './Panel.jsx';
import { StatusLED } from './StatusLED.jsx';

const STATUS_TEXT = {
  [CONNECTION_STATUS.IDLE]:              'no active session',
  [CONNECTION_STATUS.CONNECTING]:        'connecting to signaling server…',
  [CONNECTION_STATUS.WAITING_FOR_PEER]:  'waiting for peer to join',
  [CONNECTION_STATUS.NEGOTIATING]:       'negotiating webRTC offer/answer…',
  [CONNECTION_STATUS.CONNECTED]:         'peer connected — data channel open',
  [CONNECTION_STATUS.RECONNECTING]:      'reconnecting peer session…',
  [CONNECTION_STATUS.PEER_DISCONNECTED]: 'peer left session',
  [CONNECTION_STATUS.ROOM_FULL]:         'room is full',
  [CONNECTION_STATUS.INVALID_ROOM]:      'invalid room code',
  [CONNECTION_STATUS.ICE_FAILED]:        'ICE negotiation failed',
  [CONNECTION_STATUS.SIGNALING_ERROR]:   'signaling connection error',
};

export function StatusPanel({ status, roomId, error, children }) {
  const [copied, setCopied] = useState(false);

  const statusLabel = status ?? 'idle';
  const textLabel = STATUS_TEXT[status] ?? 'no active session';

  function handleCopy() {
    if (!roomId) return;
    navigator.clipboard?.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <Panel title="connection" status={statusLabel}>
      <div className="status-row">
        <StatusLED status={status} />
        <div className="status-text" style={{ flex: 1 }}>
          {roomId ? (
            <>
              room <b onClick={handleCopy} style={{ cursor: 'pointer', textDecoration: 'underline' }} title="Click to copy room code">{roomId}</b>
              {copied ? ' (copied!)' : ` — ${textLabel}`}
            </>
          ) : (
            textLabel
          )}
        </div>
      </div>
      {error && (
        <div style={{ padding: '0 16px 12px', fontSize: 12, color: 'var(--red)' }}>
          {error}
        </div>
      )}
      {children}
    </Panel>
  );
}
