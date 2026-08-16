/**
 * Room manager — the core state machine for DropLink signaling.
 *
 * State:
 *   rooms   Map<roomId, Set<WebSocket>>   at most 2 peers per room
 *   peerMeta  Map<WebSocket, { roomId, peerId }>
 *
 * TTL:
 *   When a room drops to 1 peer, a timer starts.  If a second peer hasn't
 *   joined before the timer fires, the room (and the remaining peer's socket)
 *   are cleaned up.  Configurable via ROOM_TTL_MS (default 300 000 ms / 5 min).
 *
 * roomId validation:
 *   Must be 4–64 characters, alphanumeric + hyphens only.  Rejects anything
 *   else before touching room state.
 *
 * peerId:
 *   The server generates a UUID v4 for every connected peer so the client
 *   doesn't need to supply one and can't spoof another peer's identity.
 */

import { randomUUID } from 'crypto';
import { logger } from './logger.js';
import { MSG_TYPES, makeEnvelope } from './protocol.js';

const ROOM_TTL_MS =
  parseInt(process.env.ROOM_TTL_MS, 10) || 300_000;

const MAX_PEERS_PER_ROOM = 2;

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const rooms = new Map();

/**
 * @typedef {{ roomId: string, peerId: string, ttlTimer: NodeJS.Timeout | null }} PeerMeta
 * @type {Map<import('ws').WebSocket, PeerMeta>}
 */
const peerMeta = new Map();

// ─── roomId validation ────────────────────────────────────────────────────────

const ROOM_ID_RE = /^[a-zA-Z0-9-]{4,64}$/;

/**
 * @param {string} roomId
 * @returns {boolean}
 */
export function isValidRoomId(roomId) {
  return typeof roomId === 'string' && ROOM_ID_RE.test(roomId);
}

// ─── TTL helpers ──────────────────────────────────────────────────────────────

/**
 * Start a TTL timer for a room that currently has only 1 peer.
 * If the timer fires, the room is torn down.
 *
 * @param {string} roomId
 */
function startTtlTimer(roomId) {
  const peers = rooms.get(roomId);
  if (!peers) return;

  // Each peer in the room holds a reference to the *same* timer so we can
  // cancel it from any peer's context.  We pick the first (and only) peer.
  const [ws] = peers;
  const meta = peerMeta.get(ws);
  if (!meta) return;

  // Clear any existing timer before starting a new one.
  if (meta.ttlTimer) clearTimeout(meta.ttlTimer);

  meta.ttlTimer = setTimeout(() => {
    logger.info('room-ttl-expired', { roomId, ttlMs: ROOM_TTL_MS });
    teardownRoom(roomId, null /* no "notifyExcept" peer — notify all */);
  }, ROOM_TTL_MS);
}

/**
 * Cancel any outstanding TTL timer for a room (called when a 2nd peer joins).
 *
 * @param {string} roomId
 */
function cancelTtlTimer(roomId) {
  const peers = rooms.get(roomId);
  if (!peers) return;
  for (const ws of peers) {
    const meta = peerMeta.get(ws);
    if (meta?.ttlTimer) {
      clearTimeout(meta.ttlTimer);
      meta.ttlTimer = null;
    }
  }
}

// ─── Core state helpers ───────────────────────────────────────────────────────

/**
 * Send a message to a socket if it's still open.
 *
 * @param {import('ws').WebSocket} ws
 * @param {string} data
 */
function safeSend(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(data);
  }
}

/**
 * Tear down a room: notify peers, close sockets, clean up state.
 *
 * @param {string} roomId
 * @param {import('ws').WebSocket | null} disconnectedWs  The peer that already
 *   disconnected (so we don't send them a "peer-left").  Pass null to notify
 *   all remaining peers (e.g. TTL expiry).
 */
function teardownRoom(roomId, disconnectedWs) {
  const peers = rooms.get(roomId);
  if (!peers) return;

  for (const ws of peers) {
    if (ws !== disconnectedWs) {
      safeSend(
        ws,
        makeEnvelope(MSG_TYPES.PEER_LEFT, {
          reason: disconnectedWs ? 'peer-disconnected' : 'room-expired',
        }),
      );
    }
    // Clean up timer + meta regardless.
    const meta = peerMeta.get(ws);
    if (meta?.ttlTimer) clearTimeout(meta.ttlTimer);
    peerMeta.delete(ws);
  }

  rooms.delete(roomId);
  logger.info('room-removed', { roomId });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attempt to add a peer to a room.
 *
 * @param {import('ws').WebSocket} ws
 * @param {string} roomId
 * @returns {{ success: true, peerId: string, isInitiator: boolean }
 *           | { success: false, reason: 'invalid-room-id' | 'room-full' }}
 */
export function joinRoom(ws, roomId) {
  if (!isValidRoomId(roomId)) {
    return { success: false, reason: 'invalid-room-id' };
  }

  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  const peers = rooms.get(roomId);

  if (peers.size >= MAX_PEERS_PER_ROOM) {
    return { success: false, reason: 'room-full' };
  }

  const peerId = randomUUID();
  const isInitiator = peers.size === 0; // first peer is the initiator

  peers.add(ws);
  peerMeta.set(ws, { roomId, peerId, ttlTimer: null });

  if (isInitiator) {
    // First peer — start TTL clock.
    startTtlTimer(roomId);
    logger.info('peer-joined', { roomId, peerId, peerCount: peers.size });
  } else {
    // Second peer — cancel TTL, notify the first peer.
    cancelTtlTimer(roomId);

    const [firstWs] = peers; // Set preserves insertion order
    const firstPeerId = peerMeta.get(firstWs)?.peerId;

    safeSend(
      firstWs,
      makeEnvelope(MSG_TYPES.PEER_JOINED, { peerId }),
    );

    logger.info('peer-joined', { roomId, peerId, peerCount: peers.size });

    // Let the joining peer know the other peer's id so it can address messages.
    // (The initiator already got their own peerId via room-joined; the newcomer
    //  needs to know who to send "to" for offer/answer/ice.)
    // We surface both peer ids in the room-joined payload for the second peer.
    return { success: true, peerId, isInitiator, existingPeerId: firstPeerId };
  }

  return { success: true, peerId, isInitiator };
}

/**
 * Remove a peer from its room on disconnect.
 *
 * @param {import('ws').WebSocket} ws
 */
export function removePeer(ws) {
  const meta = peerMeta.get(ws);
  if (!meta) return; // peer was never successfully joined

  const { roomId, peerId } = meta;
  const peers = rooms.get(roomId);

  if (peers) {
    peers.delete(ws);

    if (peers.size === 0) {
      // Last peer left — delete the room immediately.
      if (meta.ttlTimer) clearTimeout(meta.ttlTimer);
      rooms.delete(roomId);
      logger.info('room-removed', { roomId, reason: 'last-peer-left' });
    } else {
      // One peer remains — notify them and start TTL.
      teardownRoom(roomId, ws);
      // teardownRoom already deleted the room, so nothing more to do.
    }
  }

  peerMeta.delete(ws);
  logger.info('peer-removed', { roomId, peerId });
}

/**
 * Relay a routed message (offer/answer/ice-candidate) to the "to" peer.
 *
 * @param {import('ws').WebSocket} senderWs
 * @param {object} envelope   Already-validated envelope object (not a string).
 * @returns {{ relayed: true } | { relayed: false, reason: string }}
 */
export function relayMessage(senderWs, envelope) {
  const senderMeta = peerMeta.get(senderWs);
  if (!senderMeta) {
    return { relayed: false, reason: 'sender is not in a room' };
  }

  const { roomId, peerId: senderPeerId } = senderMeta;
  const peers = rooms.get(roomId);
  if (!peers) {
    return { relayed: false, reason: 'room not found' };
  }

  // Find the target peer by matching the "to" field against known peerIds.
  const targetId = envelope.to;
  let targetWs = null;

  for (const ws of peers) {
    if (ws === senderWs) continue;
    const meta = peerMeta.get(ws);
    if (meta?.peerId === targetId) {
      targetWs = ws;
      break;
    }
  }

  if (!targetWs) {
    return { relayed: false, reason: `peer "${targetId}" not found in room` };
  }

  // Forward the envelope as-is (the server does not inspect SDP/ICE contents).
  // We inject the sender's peerId as "from" so the recipient knows who sent it.
  const forwarded = JSON.stringify({
    type: envelope.type,
    payload: envelope.payload,
    from: senderPeerId,
  });

  safeSend(targetWs, forwarded);

  logger.debug('message-relayed', {
    roomId,
    type: envelope.type,
    from: senderPeerId,
    to: targetId,
  });

  return { relayed: true };
}

/**
 * Get a peer's metadata.
 *
 * @param {import('ws').WebSocket} ws
 * @returns {PeerMeta | undefined}
 */
export function getPeerMeta(ws) {
  return peerMeta.get(ws);
}

// ─── Metrics (for /health) ────────────────────────────────────────────────────

/**
 * @returns {{ roomCount: number, peerCount: number }}
 */
export function getMetrics() {
  let peerCount = 0;
  for (const peers of rooms.values()) peerCount += peers.size;
  return { roomCount: rooms.size, peerCount };
}
