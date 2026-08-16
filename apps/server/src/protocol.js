/**
 * DropLink signaling protocol — shared message type constants and envelope
 * validation.
 *
 * IMPORTANT: The client (Phase 2) MUST use these exact type strings. Every
 * WebSocket message on both sides travels in the following envelope:
 *
 *   {
 *     "type":    <one of MSG_TYPES>,
 *     "payload": { ... },          // present on all messages
 *     "to":      "<peerId>"        // ONLY on routed messages (offer/answer/ice-candidate)
 *   }
 *
 * Messages that require a "to" field are listed in ROUTED_TYPES.
 * The server rejects (with an "error" envelope) any message that:
 *   - is not valid JSON
 *   - is missing "type"
 *   - has an unknown "type"
 *   - is a routed type but is missing "to"
 */

/** All valid message types. */
export const MSG_TYPES = /** @type {const} */ ({
  // Client → server
  JOIN_ROOM: 'join-room',

  // Server → client(s)
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

/** Set of all valid type strings for O(1) lookup. */
export const VALID_TYPES = new Set(Object.values(MSG_TYPES));

/**
 * Routed message types — these MUST include a "to" field so the server can
 * forward them to the correct peer.
 */
export const ROUTED_TYPES = new Set([
  MSG_TYPES.OFFER,
  MSG_TYPES.ANSWER,
  MSG_TYPES.ICE_CANDIDATE,
]);

/**
 * Validate an already-parsed message object against the envelope schema.
 *
 * @param {unknown} msg  The parsed JSON value.
 * @returns {{ valid: true, msg: object } | { valid: false, reason: string }}
 */
export function validateEnvelope(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return { valid: false, reason: 'message must be a JSON object' };
  }

  const { type, payload, to } = /** @type {Record<string,unknown>} */ (msg);

  if (typeof type !== 'string' || type.trim() === '') {
    return { valid: false, reason: 'missing or empty "type" field' };
  }

  if (!VALID_TYPES.has(type)) {
    return { valid: false, reason: `unknown message type: "${type}"` };
  }

  if (payload === undefined) {
    return { valid: false, reason: 'missing "payload" field' };
  }

  if (ROUTED_TYPES.has(type)) {
    if (typeof to !== 'string' || to.trim() === '') {
      return {
        valid: false,
        reason: `message type "${type}" requires a non-empty "to" field`,
      };
    }
  }

  return { valid: true, msg };
}

/**
 * Build a well-formed error envelope to send back to a peer.
 *
 * @param {string} reason
 * @returns {string}  JSON string ready to send over the wire.
 */
export function makeErrorEnvelope(reason) {
  return JSON.stringify({
    type: MSG_TYPES.ERROR,
    payload: { message: reason },
  });
}

/**
 * Serialize an outbound server→client envelope.
 *
 * @param {string} type
 * @param {object} payload
 * @param {string} [to]
 * @returns {string}
 */
export function makeEnvelope(type, payload, to) {
  const env = { type, payload };
  if (to !== undefined) env.to = to;
  return JSON.stringify(env);
}
