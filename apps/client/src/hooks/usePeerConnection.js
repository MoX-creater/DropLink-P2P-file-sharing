/**
 * usePeerConnection
 *
 * Owns:
 *   - The signaling WebSocket connection to the server.
 *   - The RTCPeerConnection lifecycle (offer/answer/ICE).
 *   - The RTCDataChannel (created by host, received by joiner via ondatachannel).
 *   - All connection state transitions, including one-shot ICE-restart on drop.
 *
 * Does NOT own:
 *   - File chunking, transfer progress, or backpressure — that's useFileTransfer,
 *     which consumes the `dataChannel` this hook exposes.
 *
 * Reconnection contract (Phase 4):
 *   When the data channel closes unexpectedly while in CONNECTED state, the
 *   hook enters RECONNECTING and attempts one ICE restart within
 *   RECONNECT_TIMEOUT_MS (default 5 000 ms).  If the channel re-opens inside
 *   that window, status returns to CONNECTED with a new `dataChannel` value —
 *   useFileTransfer detects the new channel and drives the RESUME_REQUEST/ACK
 *   handshake.  If the window expires, status becomes PEER_DISCONNECTED and
 *   `onReconnectFailed` is called so useFileTransfer can discard partial state.
 *
 * Returned interface:
 *   {
 *     status,            // one of CONNECTION_STATUS
 *     roomId,            // string | null
 *     peerId,            // string | null  (server-assigned UUID)
 *     dataChannel,       // RTCDataChannel | null  (open and ready)
 *     error,             // string | null  (last error message)
 *     createRoom,        // () => void
 *     joinRoom,          // (roomId: string) => void
 *     cleanup,           // () => void  — idempotent
 *     onReconnectFailed, // ref callback — set by useFileTransfer to get notified
 *   }
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { MSG_TYPES, makeEnvelope, parseEnvelope, generateRoomId, getSignalingUrl } from './protocol.js';

// ─── Connection states ────────────────────────────────────────────────────────

export const CONNECTION_STATUS = /** @type {const} */ ({
  IDLE: 'idle',
  CONNECTING: 'connecting',            // WS opened, join-room sent, awaiting room-joined
  WAITING_FOR_PEER: 'waiting-for-peer', // room-joined, isInitiator, no peer yet
  NEGOTIATING: 'negotiating',          // offer-answer / ICE in flight
  CONNECTED: 'connected',              // data channel open
  RECONNECTING: 'reconnecting',        // channel dropped; ICE restart in progress
  PEER_DISCONNECTED: 'peer-disconnected', // permanent drop or reconnect timeout
  ROOM_FULL: 'room-full',
  INVALID_ROOM: 'invalid-room',
  ICE_FAILED: 'ice-failed',            // ICE failed after all restart attempts
  SIGNALING_ERROR: 'signaling-error',
});

// ─── ICE / reconnect config ───────────────────────────────────────────────────

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  // TODO (Phase N): Add TURN server entries here for NAT traversal fallback.
  // { urls: 'turn:your-turn-server.example.com', username: '...', credential: '...' }
};

const DATA_CHANNEL_LABEL = 'droplink';

/** How long to wait for ICE restart to recover before giving up (ms). */
const RECONNECT_TIMEOUT_MS = 5_000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePeerConnection() {
  const [status, setStatus] = useState(CONNECTION_STATUS.IDLE);
  const [roomId, setRoomId] = useState(null);
  const [peerId, setPeerId] = useState(null);
  const [dataChannel, setDataChannel] = useState(null);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const peerIdRef = useRef(null);
  const remotePeerIdRef = useRef(null);
  const isInitiatorRef = useRef(false);
  const iceRestartedRef = useRef(false);  // guard: only one ICE restart per drop event
  const reconnectTimerRef = useRef(null); // timeout handle for RECONNECT_TIMEOUT_MS
  const wasConnectedRef = useRef(false);  // true once we've reached CONNECTED at least once
  const cleanedUpRef = useRef(false);

  /**
   * Callback set by useFileTransfer so it can be notified when reconnection
   * fails and it should discard partial transfer state.
   * @type {React.MutableRefObject<(() => void) | null>}
   */
  const onReconnectFailedRef = useRef(null);

  // ── helpers ────────────────────────────────────────────────────────────────

  const transition = useCallback((newStatus, newError = null) => {
    setStatus(newStatus);
    setError(newError);
  }, []);

  const wsSend = useCallback((type, payload, to) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(makeEnvelope(type, payload, to));
    }
  }, []);

  // ── Reconnect timer ────────────────────────────────────────────────────────

  function clearReconnectTimer() {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function startReconnectTimer() {
    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      // Use the ref flag rather than status, since startNegotiation() may have
      // already transitioned to NEGOTIATING while the timer was outstanding.
      if (!iceRestartedRef.current) return; // already recovered
      setStatus((prev) => {
        const inReconnectWindow = prev === CONNECTION_STATUS.RECONNECTING ||
          prev === CONNECTION_STATUS.NEGOTIATING;
        if (!inReconnectWindow) return prev;
        setError('Reconnection timed out — peer may have left');
        onReconnectFailedRef.current?.();
        return CONNECTION_STATUS.PEER_DISCONNECTED;
      });
    }, RECONNECT_TIMEOUT_MS);
  }

  // ── RTCDataChannel wiring ───────────────────────────────────────────────────

  const wireDataChannel = useCallback((dc) => {
    dcRef.current = dc;

    dc.onopen = () => {
      clearReconnectTimer();
      wasConnectedRef.current = true;
      setDataChannel(dc);
      transition(CONNECTION_STATUS.CONNECTED);
    };

    dc.onclose = () => {
      setDataChannel(null);
      dcRef.current = null;

      setStatus((prev) => {
        if (prev === CONNECTION_STATUS.CONNECTED && !iceRestartedRef.current) {
          iceRestartedRef.current = true;
          startReconnectTimer();
          // Kick ICE restart and renegotiation directly — calling restartIce()
          // from inside a state updater is safe since it only mutates the PC.
          const pc = pcRef.current;
          if (pc) {
            pc.restartIce();
            if (isInitiatorRef.current) {
              // startNegotiation is async; schedule it so we're out of the setter.
              Promise.resolve().then(() => startNegotiationRef.current?.());
            }
          }
          return CONNECTION_STATUS.RECONNECTING;
        }
        // Already tried reconnecting, or never reached CONNECTED — hard fail.
        if (prev === CONNECTION_STATUS.RECONNECTING) {
          clearReconnectTimer();
          onReconnectFailedRef.current?.();
          setError('Connection could not be re-established');
          return CONNECTION_STATUS.PEER_DISCONNECTED;
        }
        // Any other state: only transition if we were connected.
        if (prev === CONNECTION_STATUS.CONNECTED) {
          return CONNECTION_STATUS.PEER_DISCONNECTED;
        }
        return prev;
      });
    };

    dc.onerror = (evt) => {
      const msg = evt.error?.message ?? 'data channel error';
      transition(CONNECTION_STATUS.SIGNALING_ERROR, msg);
    };
  }, [transition]);

  // ── RTCPeerConnection setup ─────────────────────────────────────────────────

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    pcRef.current = pc;
    iceRestartedRef.current = false;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && remotePeerIdRef.current) {
        wsSend(MSG_TYPES.ICE_CANDIDATE, { candidate: candidate.toJSON() }, remotePeerIdRef.current);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;

      if (state === 'connected' || state === 'completed') {
        // ICE (re-)established — the data channel onopen will fire shortly and
        // drive the final status transition.  Clear the reconnect timer here
        // as an early signal in case onopen is slow.
        clearReconnectTimer();
      }

      if (state === 'failed') {
        // If we're in RECONNECTING and ICE itself fails, give up immediately.
        setStatus((prev) => {
          if (
            prev === CONNECTION_STATUS.RECONNECTING ||
            prev === CONNECTION_STATUS.NEGOTIATING
          ) {
            clearReconnectTimer();
            onReconnectFailedRef.current?.();
            setError('ICE negotiation failed');
            return CONNECTION_STATUS.ICE_FAILED;
          }
          return prev;
        });
      }

      if (state === 'disconnected') {
        // Transient — peer may self-heal; don't hard-fail yet.
        setStatus((prev) =>
          prev === CONNECTION_STATUS.CONNECTED
            ? CONNECTION_STATUS.NEGOTIATING
            : prev,
        );
      }
    };

    pc.ondatachannel = ({ channel }) => {
      // A new data channel arrived — could be the reconnect recovery channel.
      wireDataChannel(channel);
    };

    return pc;
  }, [wsSend, wireDataChannel]);

  // ── Offer/Answer negotiation ────────────────────────────────────────────────

  const startNegotiationRef = useRef(null);

  const startNegotiation = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;

    try {
      transition(CONNECTION_STATUS.NEGOTIATING);

      const dc = pc.createDataChannel(DATA_CHANNEL_LABEL);
      wireDataChannel(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsSend(MSG_TYPES.OFFER, { sdp: pc.localDescription }, remotePeerIdRef.current);
    } catch (err) {
      transition(CONNECTION_STATUS.SIGNALING_ERROR, err.message);
    }
  }, [transition, wireDataChannel, wsSend]);

  useEffect(() => {
    startNegotiationRef.current = startNegotiation;
  }, [startNegotiation]);

  // ── Signaling message handlers ──────────────────────────────────────────────

  const handleServerMessage = useCallback(async (raw) => {
    const msg = parseEnvelope(raw);
    if (!msg) return;

    const { type, payload } = msg;

    switch (type) {

      case MSG_TYPES.ROOM_JOINED: {
        const { peerId: assignedId, isInitiator, roomId: joinedRoom, existingPeerId } = payload;
        peerIdRef.current = assignedId;
        setPeerId(assignedId);
        setRoomId(joinedRoom);
        isInitiatorRef.current = isInitiator;
        if (isInitiator) {
          transition(CONNECTION_STATUS.WAITING_FOR_PEER);
        } else {
          remotePeerIdRef.current = existingPeerId;
          transition(CONNECTION_STATUS.NEGOTIATING);
        }
        break;
      }

      case MSG_TYPES.PEER_JOINED: {
        const { peerId: joinerPeerId } = payload;
        remotePeerIdRef.current = joinerPeerId;
        await startNegotiationRef.current?.();
        break;
      }

      case MSG_TYPES.PEER_LEFT: {
        clearReconnectTimer();
        onReconnectFailedRef.current?.();
        transition(
          CONNECTION_STATUS.PEER_DISCONNECTED,
          payload?.reason === 'room-expired' ? 'room expired' : 'peer disconnected',
        );
        break;
      }

      case MSG_TYPES.OFFER: {
        try {
          const pc = pcRef.current;
          if (!pc) break;
          remotePeerIdRef.current = msg.from ?? remotePeerIdRef.current;
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          wsSend(MSG_TYPES.ANSWER, { sdp: pc.localDescription }, remotePeerIdRef.current);
        } catch (err) {
          transition(CONNECTION_STATUS.SIGNALING_ERROR, err.message);
        }
        break;
      }

      case MSG_TYPES.ANSWER: {
        try {
          const pc = pcRef.current;
          if (!pc) break;
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        } catch (err) {
          transition(CONNECTION_STATUS.SIGNALING_ERROR, err.message);
        }
        break;
      }

      case MSG_TYPES.ICE_CANDIDATE: {
        try {
          const pc = pcRef.current;
          if (!pc) break;
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (err) {
          console.warn('[usePeerConnection] addIceCandidate (likely stale):', err.message);
        }
        break;
      }

      case MSG_TYPES.ROOM_FULL: {
        transition(CONNECTION_STATUS.ROOM_FULL, 'room is full');
        cleanupInternal();
        break;
      }

      case MSG_TYPES.ERROR: {
        const reason = payload?.message ?? 'unknown server error';
        if (reason.includes('invalid roomId') || reason.includes('invalid-room-id')) {
          transition(CONNECTION_STATUS.INVALID_ROOM, reason);
        } else {
          transition(CONNECTION_STATUS.SIGNALING_ERROR, reason);
        }
        cleanupInternal();
        break;
      }

      default:
        break;
    }
  }, [transition, wsSend]);

  // ── Core connect + join ─────────────────────────────────────────────────────

  const connectAndJoin = useCallback((targetRoomId) => {
    cleanupInternal();
    cleanedUpRef.current = false;
    wasConnectedRef.current = false;

    let signalingUrl;
    try {
      signalingUrl = getSignalingUrl();
    } catch (err) {
      transition(CONNECTION_STATUS.SIGNALING_ERROR, err.message);
      return;
    }

    transition(CONNECTION_STATUS.CONNECTING);

    const ws = new WebSocket(signalingUrl);
    wsRef.current = ws;

    createPeerConnection();

    ws.onopen = () => {
      wsSend(MSG_TYPES.JOIN_ROOM, { roomId: targetRoomId });
    };

    ws.onmessage = (evt) => {
      handleServerMessage(evt.data);
    };

    ws.onerror = () => {
      transition(CONNECTION_STATUS.SIGNALING_ERROR, 'WebSocket connection error');
    };

    ws.onclose = (evt) => {
      const terminalStates = new Set([
        CONNECTION_STATUS.ROOM_FULL,
        CONNECTION_STATUS.INVALID_ROOM,
        CONNECTION_STATUS.ICE_FAILED,
        CONNECTION_STATUS.PEER_DISCONNECTED,
        CONNECTION_STATUS.IDLE,
        CONNECTION_STATUS.RECONNECTING, // let reconnect logic own this transition
      ]);
      setStatus((prev) => {
        if (terminalStates.has(prev)) return prev;
        if (!evt.wasClean) {
          setError('signaling connection lost');
          return CONNECTION_STATUS.SIGNALING_ERROR;
        }
        return prev;
      });
    };
  }, [transition, createPeerConnection, wsSend, handleServerMessage]);

  // ── Cleanup (idempotent) ────────────────────────────────────────────────────

  function cleanupInternal() {
    if (cleanedUpRef.current) return;
    cleanedUpRef.current = true;

    clearReconnectTimer();

    const dc = dcRef.current;
    if (dc) {
      try { dc.close(); } catch { /* ignore */ }
      dcRef.current = null;
    }

    const pc = pcRef.current;
    if (pc) {
      try { pc.close(); } catch { /* ignore */ }
      pcRef.current = null;
    }

    const ws = wsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        try { ws.close(); } catch { /* ignore */ }
      }
      wsRef.current = null;
    }

    peerIdRef.current = null;
    remotePeerIdRef.current = null;
    isInitiatorRef.current = false;
    iceRestartedRef.current = false;
    wasConnectedRef.current = false;
  }

  const cleanup = useCallback(() => {
    cleanupInternal();
    setDataChannel(null);
    setPeerId(null);
    setRoomId(null);
    setError(null);
    setStatus(CONNECTION_STATUS.IDLE);
    cleanedUpRef.current = false;
  }, []);

  useEffect(() => {
    return () => { cleanupInternal(); };
  }, []);

  // ── Public API ──────────────────────────────────────────────────────────────

  const createRoom = useCallback(() => {
    const id = generateRoomId();
    connectAndJoin(id);
  }, [connectAndJoin]);

  const joinRoom = useCallback((targetRoomId) => {
    connectAndJoin(targetRoomId);
  }, [connectAndJoin]);

  return {
    status,
    roomId,
    peerId,
    dataChannel,
    error,
    createRoom,
    joinRoom,
    cleanup,
    // Exposed so useFileTransfer can register its reconnect-failed callback.
    onReconnectFailedRef,
  };
}
