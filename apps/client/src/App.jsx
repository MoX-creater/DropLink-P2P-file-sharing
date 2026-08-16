/**
 * App.jsx — Phase 4 glassmorphism UI.
 *
 * Assembles StatusPanel, RoomEntry, TransferCard and ErrorBanner into a
 * coherent layout that covers every connection and transfer state with
 * distinct, designed representations and contextual next-action prompts.
 *
 * Layout:
 *   Page (dark navy background + two radial orbs for depth)
 *   └─ centred column (max-width 600 px)
 *      ├─ Header:       wordmark + tagline
 *      ├─ StatusPanel:  live connection dot + room code
 *      ├─ RoomEntry:    create / join form OR busy / error messaging
 *      ├─ DropZone:     drag-and-drop or click-to-pick file (CONNECTED only)
 *      ├─ TransferList: one TransferCard per transfer (all directions/states)
 *      └─ Footer:       disconnect button when not idle
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { usePeerConnection, CONNECTION_STATUS } from './hooks/usePeerConnection.js';
import { useFileTransfer }                      from './hooks/useFileTransfer.js';
import { TRANSFER_STATUS }                      from './hooks/transferProtocol.js';
import { StatusPanel }                          from './components/StatusPanel.jsx';
import { RoomEntry }                            from './components/RoomEntry.jsx';
import { TransferCard }                         from './components/TransferCard.jsx';
import { ErrorBanner }                          from './components/ErrorBanner.jsx';
import {
  color, font, space, radius, glassPanel, transition, shadow,
} from './styles/glass.js';

// ─── Error context for states that need a banner above the room entry ─────────

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

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const {
    status, roomId, error: connError,
    dataChannel, createRoom, joinRoom, cleanup,
    onReconnectFailedRef,
  } = usePeerConnection();

  const {
    transfers, sendFile, cancelTransfer, pauseTransfer, resumeTransfer,
  } = useFileTransfer(dataChannel, onReconnectFailedRef);

  const fileInputRef = useRef(null);
  const isConnected  = status === CONNECTION_STATUS.CONNECTED;

  // ── File selection ──────────────────────────────────────────────────────────

  const handleFileChosen = useCallback((file) => {
    if (!file || !isConnected) return;
    sendFile(file);
  }, [isConnected, sendFile]);

  function handleInputChange(e) {
    handleFileChosen(e.target.files?.[0]);
    e.target.value = '';
  }

  // ── Drag-and-drop ───────────────────────────────────────────────────────────

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileChosen(file);
  }

  // ── Derived flags ───────────────────────────────────────────────────────────

  const bannerMsg = BANNER_MSG[status] ?? null;
  // Show the disconnect button whenever we're not cleanly idle.
  const showDisconnect = status !== CONNECTION_STATUS.IDLE;

  // Active transfers: those that could still change state.
  const activeTransfers = transfers.filter((t) =>
    t.status === TRANSFER_STATUS.TRANSFERRING ||
    t.status === TRANSFER_STATUS.PAUSED       ||
    t.status === TRANSFER_STATUS.RESUMING     ||
    t.status === TRANSFER_STATUS.INTERRUPTED,
  );
  const doneTransfers = transfers.filter((t) => !activeTransfers.includes(t));

  return (
    <>
      {/* ── Global styles: Inter font + page background ─────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        html { font-family: ${font.family}; }

        body {
          background: ${color.bg};
          color: ${color.textPrimary};
          min-height: 100vh;
          overflow-x: hidden;
        }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${color.glassBorder}; border-radius: 3px; }

        /* Keyframes used by children */
        @keyframes droplink-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
        @keyframes droplink-shimmer {
          0%   { opacity: 1; }
          50%  { opacity: 0.55; }
          100% { opacity: 1; }
        }
        @keyframes droplink-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ── Background orbs ─────────────────────────────────────────────── */}
      <div aria-hidden style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '-20%', left: '-10%',
          width: 600, height: 600,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color.bgOrb1} 0%, transparent 70%)`,
          filter: 'blur(40px)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-15%', right: '-8%',
          width: 500, height: 500,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color.bgOrb2} 0%, transparent 70%)`,
          filter: 'blur(40px)',
        }} />
      </div>

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <main style={{
        position:      'relative',
        zIndex:        1,
        maxWidth:      600,
        margin:        '0 auto',
        padding:       `${space[10]}px ${space[5]}px ${space[12]}px`,
        animation:     'droplink-fade-in 0.35s ease both',
      }}>

        {/* Header */}
        <header style={{ marginBottom: space[8], textAlign: 'center' }}>
          <h1 style={{
            fontSize:    font.size.hero,
            fontWeight:  font.weight.extrabold,
            background:  'linear-gradient(135deg, #f1f5f9 20%, #818cf8 80%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            marginBottom: space[2],
          }}>
            DropLink
          </h1>
          <p style={{ fontSize: font.size.base, color: color.textSecondary }}>
            Peer-to-peer file sharing — no server, no storage
          </p>
        </header>

        {/* Connection status */}
        <StatusPanel status={status} roomId={roomId} error={connError} />

        {/* Contextual error banner (above room entry) */}
        <ErrorBanner
          message={bannerMsg}
          action={showDisconnect ? 'Start over' : undefined}
          onAction={cleanup}
        />

        {/* Room create / join controls */}
        <RoomEntry
          status={status}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          onDisconnect={cleanup}
        />

        {/* File drop zone — only when connected */}
        {isConnected && (
          <DropZone
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          />
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleInputChange}
          aria-label="Choose file to send"
        />

        {/* Active transfers */}
        {activeTransfers.length > 0 && (
          <TransferSection heading="In progress">
            {activeTransfers.map((t) => (
              <TransferCard
                key={t.id}
                transfer={t}
                onCancel={() => cancelTransfer(t.id)}
                onPause={() => pauseTransfer(t.id)}
                onResume={() => resumeTransfer(t.id)}
              />
            ))}
          </TransferSection>
        )}

        {/* Completed / finished transfers */}
        {doneTransfers.length > 0 && (
          <TransferSection heading="Completed">
            {doneTransfers.map((t) => (
              <TransferCard
                key={t.id}
                transfer={t}
                onCancel={() => cancelTransfer(t.id)}
                onPause={() => pauseTransfer(t.id)}
                onResume={() => resumeTransfer(t.id)}
              />
            ))}
          </TransferSection>
        )}

        {/* Disconnect footer */}
        {showDisconnect && !isConnected && status !== CONNECTION_STATUS.WAITING_FOR_PEER && (
          <footer style={{ marginTop: space[6], display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={cleanup}
              style={{
                padding:      `${space[2]}px ${space[5]}px`,
                background:   'transparent',
                border:       `1px solid rgba(239,68,68,0.30)`,
                borderRadius: radius.full,
                color:        color.danger,
                fontSize:     font.size.sm,
                fontWeight:   font.weight.medium,
                cursor:       'pointer',
                transition:   transition.fast,
              }}
            >
              Clear &amp; start over
            </button>
          </footer>
        )}

        {showDisconnect && isConnected && (
          <footer style={{ marginTop: space[6], display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={cleanup}
              style={{
                padding:      `${space[2]}px ${space[5]}px`,
                background:   'transparent',
                border:       `1px solid ${color.glassBorder}`,
                borderRadius: radius.full,
                color:        color.textSecondary,
                fontSize:     font.size.sm,
                cursor:       'pointer',
                transition:   transition.fast,
              }}
            >
              Disconnect
            </button>
          </footer>
        )}
      </main>
    </>
  );
}

// ─── DropZone ─────────────────────────────────────────────────────────────────

function DropZone({ onDragOver, onDrop, onClick }) {
  const [dragging, setDragging] = useHover();

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Drop a file here or click to choose"
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
      onDragOver={(e) => { setDragging(true); onDragOver(e); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { setDragging(false); onDrop(e); }}
      style={{
        ...glassPanel,
        borderRadius:  radius.xl,
        padding:       `${space[10]}px ${space[6]}px`,
        marginBottom:  space[5],
        textAlign:     'center',
        cursor:        'pointer',
        border:        `2px dashed ${dragging ? color.accent : color.glassBorder}`,
        background:    dragging ? `rgba(99,102,241,0.08)` : color.glass,
        boxShadow:     dragging ? shadow.accent : shadow.glass,
        transition:    transition.base,
        outline:       'none',
      }}
    >
      <div style={{
        fontSize:    32,
        marginBottom: space[3],
        opacity:     dragging ? 1 : 0.6,
        transition:  transition.base,
      }}>
        {dragging ? '📂' : '📁'}
      </div>
      <p style={{
        fontSize:   font.size.md,
        fontWeight: font.weight.semibold,
        color:      dragging ? color.accent : color.textPrimary,
        marginBottom: space[1],
        transition: transition.base,
      }}>
        {dragging ? 'Drop to send' : 'Drop a file here'}
      </p>
      <p style={{ fontSize: font.size.sm, color: color.textMuted }}>
        or click to choose from your device
      </p>
    </div>
  );
}

// ─── TransferSection ──────────────────────────────────────────────────────────

function TransferSection({ heading, children }) {
  return (
    <section style={{ marginBottom: space[5] }}>
      <h2 style={{
        fontSize:     font.size.sm,
        fontWeight:   font.weight.semibold,
        color:        color.textMuted,
        textTransform:'uppercase',
        letterSpacing:'0.08em',
        marginBottom: space[3],
      }}>
        {heading}
      </h2>
      {children}
    </section>
  );
}

// ─── useHover helper ──────────────────────────────────────────────────────────

function useHover() {
  const [val, setVal] = useState(false);
  return [val, setVal];
}
