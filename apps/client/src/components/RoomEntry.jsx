/**
 * RoomEntry — create / join room controls.
 *
 * Terminal aesthetic implementation:
 *   IDLE / terminal states  → create room button, divider, join code input + button
 *   Busy (connecting etc.)  → status message + cancel option
 *   CONNECTED               → hidden (handled by parent / dropzone)
 */

import { useState } from 'react';
import { CONNECTION_STATUS } from '../hooks/usePeerConnection.js';
import { Button } from './Button.jsx';

const BUSY_STATES = new Set([
  CONNECTION_STATUS.CONNECTING,
  CONNECTION_STATUS.WAITING_FOR_PEER,
  CONNECTION_STATUS.NEGOTIATING,
  CONNECTION_STATUS.RECONNECTING,
]);

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
    <div className="actions">
      {/* Contextual hint for error states */}
      {isError && HINT[status] && (
        <p style={{ color: 'var(--red)', fontSize: 12, marginBottom: 14 }}>
          {HINT[status]}
        </p>
      )}

      {/* Busy state */}
      {isBusy && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            {BUSY_LABEL[status]}
          </p>
          <Button variant="danger" onClick={onDisconnect}>
            Cancel and start over
          </Button>
        </div>
      )}

      {/* Idle or error — show form */}
      {(isIdle || isError) && (
        <>
          <Button onClick={onCreateRoom}>
            create room
          </Button>

          <div className="divider-row">or join existing</div>

          <div className="join-row">
            <input
              type="text"
              placeholder="room code, e.g. 7XQP2K"
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
            >
              join
            </button>
          </div>
        </>
      )}
    </div>
  );
}
