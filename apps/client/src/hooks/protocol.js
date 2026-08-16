/**
 * DropLink client-side signaling protocol constants and envelope helpers.
 *
 * MUST stay in sync with apps/server/src/protocol.js.
 * The server defines the canonical shapes; this file mirrors them exactly.
 * If you change one, change the other.
 *
 * Envelope shape (all WebSocket messages in both directions):
 *   {
 *     "type":    <one of MSG_TYPES>,
 *     "payload": { ... },
 *     "to":      "<peerId>"   // only on OFFER, ANSWER, ICE_CANDIDATE
 *   }
 */

/** All valid message type strings — mirrors server's MSG_TYPES. */
export const MSG_TYPES = /** @type {const} */ ({
  // Client → server
  JOIN_ROOM: 'join-room',

  // Server → client
  ROOM_JOINED: 'room-joined',
  ROOM_FULL: 'room-full',
  PEER_JOINED: 'peer-joined',
  PEER_LEFT: 'peer-left',
  ERROR: 'error',

  // Client → server → peer  (routed: require "to")
  OFFER: 'offer',
  ANSWER: 'answer',
  ICE_CANDIDATE: 'ice-candidate',
});

/**
 * Build a serialized envelope ready to send over the WebSocket.
 *
 * @param {string} type
 * @param {object} payload
 * @param {string} [to]   Target peerId — required for OFFER/ANSWER/ICE_CANDIDATE.
 * @returns {string}
 */
export function makeEnvelope(type, payload, to) {
  const env = { type, payload };
  if (to !== undefined) env.to = to;
  return JSON.stringify(env);
}

/**
 * Parse a raw WebSocket message string into an envelope object.
 * Returns null if the string is not valid JSON or doesn't have a known type.
 *
 * @param {string} raw
 * @returns {{ type: string, payload: object, to?: string } | null}
 */
export function parseEnvelope(raw) {
  try {
    const msg = JSON.parse(raw);
    if (
      msg === null ||
      typeof msg !== 'object' ||
      typeof msg.type !== 'string'
    ) {
      return null;
    }
    return msg;
  } catch {
    return null;
  }
}

/**
 * Generate a random room ID: 6 uppercase alphanumeric characters.
 * Satisfies the server's roomId validation rule (4–64 chars, [a-zA-Z0-9-]).
 *
 * @returns {string}
 */
export function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  // Use crypto.getRandomValues when available (browser + Node 19+), else Math.random.
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    for (const b of bytes) id += chars[b % chars.length];
  } else {
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
