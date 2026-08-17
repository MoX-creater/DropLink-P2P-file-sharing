/**
 * App.jsx — DropLink Terminal / Hacker Visual UI.
 *
 * Implements the terminal design system matching droplink-mockup.html:
 *   - IBM Plex Mono typography, sharp corners, custom properties color palette
 *   - Reusable Panel, Button, StatusLED, ProtocolLog, RoomEntry, StatusPanel
 *   - Live Protocol Log listening to real connection & file transfer events
 *   - Master TRANSFERS panel with stacked transfer rows
 *   - Strictly preserves all hook logic and transfer protocol state
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { usePeerConnection, CONNECTION_STATUS } from './hooks/usePeerConnection.js';
import { useFileTransfer }                      from './hooks/useFileTransfer.js';
import { TRANSFER_STATUS, formatBytes }         from './hooks/transferProtocol.js';
import { getSignalingUrl }                      from './hooks/protocol.js';
import { StatusPanel }                          from './components/StatusPanel.jsx';
import { RoomEntry }                            from './components/RoomEntry.jsx';
import { TransferCard }                         from './components/TransferCard.jsx';
import { ErrorBanner }                          from './components/ErrorBanner.jsx';
import { ProtocolLog, capLogEntries }           from './components/ProtocolLog.jsx';
import { Panel }                                from './components/Panel.jsx';
import { Button }                               from './components/Button.jsx';
import { isFsapiSupported }                     from './hooks/receiverSink.js';
import './styles/terminal.css';

const BANNER_MSG = {
  [CONNECTION_STATUS.PEER_DISCONNECTED]:
    'Your peer left the session. You can rejoin the same room if they haven\'t left for good, or create a new one.',
  [CONNECTION_STATUS.ROOM_FULL]:
    'This room already has two participants. Ask your peer for a different room code, or create your own.',
  [CONNECTION_STATUS.INVALID_ROOM]:
    'Room code not recognised. Codes are 6 characters (letters and numbers). Double-check and try again.',
  [CONNECTION_STATUS.ICE_FAILED]:
    'WebRTC negotiation failed after one retry attempt. This is usually a firewall or NAT issue — try again or ask your peer to create a new room.',
  [CONNECTION_STATUS.SIGNALING_ERROR]:
    'Lost contact with the signaling server. Check your network connection, then try again.',
};

export default function App() {
  const {
    status, roomId, error: connError,
    dataChannel, createRoom, joinRoom, cleanup,
    onReconnectFailedRef,
  } = usePeerConnection();

  const {
    transfers, sendFile, cancelTransfer, pauseTransfer, resumeTransfer,
  } = useFileTransfer(dataChannel, onReconnectFailedRef);

  const fileInputRef    = useRef(null);
  const [dragging, setDragging] = useState(false);
  const isConnected     = status === CONNECTION_STATUS.CONNECTED;

  // ── Protocol Log state & helper ─────────────────────────────────────────────

  const [logs, setLogs]            = useState([]);
  const sessionStartRef            = useRef(Date.now());
  const prevStatusRef             = useRef(status);
  const loggedProgressRef          = useRef({});

  const addLog = useCallback((htmlMessage, type = 'info') => {
    const elapsedMs = Date.now() - sessionStartRef.current;
    const newEntry = {
      id: `${Date.now()}-${Math.random()}`,
      elapsedMs,
      htmlMessage,
      type,
    };
    setLogs((prev) => capLogEntries(prev, newEntry));
  }, []);

  // ── Log connection lifecycle events ─────────────────────────────────────────

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    if (prevStatus === status) return;
    prevStatusRef.current = status;

    if (status === CONNECTION_STATUS.CONNECTING) {
      sessionStartRef.current = Date.now();
      setLogs([]);
      try {
        const signalingUrl = getSignalingUrl();
        addLog(`socket connecting <b>${signalingUrl}</b>`, 'info');
      } catch (err) {
        addLog(`signaling error: <b>${err.message}</b>`, 'err');
      }
    } else if (status === CONNECTION_STATUS.WAITING_FOR_PEER) {
      if (roomId) addLog(`join-room <b>${roomId}</b>`, 'info');
      addLog('room-joined — waiting for peer', 'ok');
    } else if (status === CONNECTION_STATUS.NEGOTIATING) {
      addLog('peer-joined — negotiating offer/answer', 'ok');
      addLog('ice candidate gathered <b>stun:19302</b>', 'info');
    } else if (status === CONNECTION_STATUS.CONNECTED) {
      addLog('data channel <b>open</b>', 'ok');
    } else if (status === CONNECTION_STATUS.RECONNECTING) {
      addLog('connection dropped — attempting ice restart', 'err');
    } else if (status === CONNECTION_STATUS.PEER_DISCONNECTED) {
      addLog('peer left session', 'err');
    } else if (status === CONNECTION_STATUS.ICE_FAILED) {
      addLog('ICE negotiation <b>failed</b>', 'err');
    } else if (status === CONNECTION_STATUS.SIGNALING_ERROR) {
      addLog(`signaling error: <b>${connError || 'connection error'}</b>`, 'err');
    } else if (status === CONNECTION_STATUS.ROOM_FULL) {
      addLog('room is <b>full</b>', 'err');
    } else if (status === CONNECTION_STATUS.INVALID_ROOM) {
      addLog('invalid room code', 'err');
    }
  }, [status, roomId, connError, addLog]);

  // ── Log transfer events ─────────────────────────────────────────────────────

  useEffect(() => {
    transfers.forEach((t) => {
      const lastLogged = loggedProgressRef.current[t.id];

      if (!lastLogged) {
        loggedProgressRef.current[t.id] = { status: t.status, milestones: new Set() };
        addLog(`transfer start <b>${t.name}</b> (${formatBytes(t.size)})`, 'info');
      } else if (lastLogged.status !== t.status) {
        lastLogged.status = t.status;
        if (t.status === TRANSFER_STATUS.COMPLETE) {
          addLog(`transfer <b>complete</b> <b>${t.name}</b> (${formatBytes(t.size)})`, 'ok');
        } else if (t.status === TRANSFER_STATUS.ERROR || t.status === TRANSFER_STATUS.INTERRUPTED || t.status === TRANSFER_STATUS.INTEGRITY_MISMATCH) {
          addLog(`transfer <b>failed</b> <b>${t.name}</b> — ${t.error || t.status}`, 'err');
        } else if (t.status === TRANSFER_STATUS.PAUSED) {
          addLog(`transfer paused <b>${t.name}</b>`, 'info');
        } else if (t.status === TRANSFER_STATUS.RESUMING) {
          addLog(`transfer resuming <b>${t.name}</b>`, 'info');
        }
      }

      // Milestones 25%, 50%, 75%
      if (t.status === TRANSFER_STATUS.TRANSFERRING && t.progress > 0 && t.progress < 1) {
        const pct = Math.floor(t.progress * 100);
        const milestone = Math.floor(pct / 25) * 25;
        if (milestone > 0 && milestone < 100 && !lastLogged?.milestones?.has(milestone)) {
          lastLogged.milestones.add(milestone);
          addLog(`transfer progress <b>${t.name}</b> — ${milestone}%`, 'info');
        }
      }
    });
  }, [transfers, addLog]);

  // ── File selection & drop handlers ──────────────────────────────────────────

  const handleFileChosen = useCallback((file) => {
    if (!file || !isConnected) return;
    sendFile(file);
  }, [isConnected, sendFile]);

  function handleInputChange(e) {
    handleFileChosen(e.target.files?.[0]);
    e.target.value = '';
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileChosen(file);
  }

  // ── Derived flags ───────────────────────────────────────────────────────────

  const bannerMsg = BANNER_MSG[status] ?? null;
  const showDisconnect = status !== CONNECTION_STATUS.IDLE;

  return (
    <div className="wrap">
      {/* Top metadata */}
      <div className="top-meta">
        <span>DROPLINK</span>
        <span>WEBRTC / P2P TRANSFER</span>
      </div>

      {/* Brand header */}
      <div className="brand">
        <div className="brand-mark">
          <span className="dot"></span><span className="dot d2"></span>
          <span>peer session</span>
        </div>
        <h1>droplink<span className="cursor"></span></h1>
        <div className="tagline">
          files move browser to browser over an <span>encrypted data channel</span>. nothing touches a server.
        </div>
      </div>

      {/* Connection Panel & Room Controls */}
      <StatusPanel status={status} roomId={roomId} error={connError}>
        <RoomEntry
          status={status}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          onDisconnect={cleanup}
        />
      </StatusPanel>

      {/* Contextual Error Banner */}
      <ErrorBanner
        message={bannerMsg}
        action={showDisconnect ? 'Start over' : undefined}
        onAction={cleanup}
      />

      {/* File Drop Zone (CONNECTED state only) */}
      {isConnected && (
        <div
          role="button"
          tabIndex={0}
          className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <div className="drop-icon">📁</div>
          <div className="drop-title">
            {dragging ? '$ drop file to send' : '$ select or drop file to send'}
          </div>
          <div className="drop-sub">
            direct peer-to-peer chunked streaming
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleInputChange}
        aria-label="Choose file to send"
      />

      {/* Protocol Log Panel */}
      <ProtocolLog logs={logs} />

      {/* Master TRANSFERS Panel (stacked rows inside single panel) */}
      {transfers.length > 0 && (
        <Panel title="transfers" status={`${transfers.length} item(s)`}>
          {transfers.map((t) => (
            <TransferCard
              key={t.id}
              transfer={t}
              onCancel={() => cancelTransfer(t.id)}
              onPause={() => pauseTransfer(t.id)}
              onResume={() => resumeTransfer(t.id)}
            />
          ))}
        </Panel>
      )}

      {/* Disconnect action */}
      {showDisconnect && (
        <div style={{ marginTop: 20, marginBottom: 20, textAlign: 'center' }}>
          <Button
            variant="secondary"
            onClick={cleanup}
            style={{ width: 'auto', display: 'inline-block', padding: '10px 24px' }}
          >
            disconnect &amp; clear session
          </Button>
        </div>
      )}

      {/* Footer metadata */}
      <div className="footer-meta">
        <span># stun-only · no turn fallback</span>
        <span># chunk size 64kb</span>
      </div>
      {!isFsapiSupported() && (
        <div className="footer-hint">
          # best experience on chrome/edge — streaming writes, no size cap
        </div>
      )}
    </div>
  );
}
