import React, { useState } from 'react';

export default function RoomPanel({ roomId, isHost, connectionStatus, onCreateRoom, onJoinRoom, onDisconnect }) {
  const [inputId, setInputId] = useState('');
  const [copied, setCopied] = useState(false);

  const isConnected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';
  const isActive = isConnected || isConnecting;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may not be available */
    }
  };

  const handleJoin = () => {
    if (inputId.trim()) {
      onJoinRoom(inputId.trim());
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleJoin();
  };

  return (
    <div className="glass-card room-panel">
      <h2 className="room-panel__title">
        {isActive ? (isHost ? '📡 Hosting Room' : '🔗 Joined Room') : '🚀 Start Sharing'}
      </h2>

      {/* Show room ID when active */}
      {isActive && roomId && (
        <div className="room-id-display">
          <span className="room-id-display__label">Room</span>
          <span className="room-id-display__id">{roomId}</span>
          <button
            id="copy-room-id"
            className="room-id-display__copy"
            onClick={handleCopy}
            title="Copy Room ID"
          >
            {copied ? '✅' : '📋'}
          </button>
        </div>
      )}

      {/* Actions when not active */}
      {!isActive && (
        <>
          <div className="room-panel__actions">
            <button id="create-room-btn" className="btn btn--primary" onClick={onCreateRoom}>
              ✦ Create Room
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--glass-border)' }} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 500 }}>or join</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--glass-border)' }} />
          </div>

          <div className="room-panel__input-group">
            <input
              id="room-id-input"
              className="room-panel__input"
              type="text"
              placeholder="Enter Room ID"
              value={inputId}
              onChange={(e) => setInputId(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              maxLength={6}
              autoComplete="off"
              spellCheck="false"
            />
            <button
              id="join-room-btn"
              className="btn btn--secondary"
              onClick={handleJoin}
              disabled={!inputId.trim()}
            >
              Join →
            </button>
          </div>
        </>
      )}

      {/* Disconnect button */}
      {isActive && (
        <button id="disconnect-btn" className="btn btn--danger" onClick={onDisconnect}>
          ✕ Disconnect
        </button>
      )}
    </div>
  );
}
