/**
 * DropLink data-channel transfer protocol.
 *
 * All control messages travel as UTF-8 JSON strings over the RTCDataChannel.
 * Raw file bytes are sent as ArrayBuffer chunks — NOT JSON-wrapped — for
 * performance. The receiver distinguishes them by typeof / instanceof check:
 *   typeof event.data === 'string'      → control message  (parse as JSON)
 *   event.data instanceof ArrayBuffer   → binary chunk     (append directly)
 *
 * Control message envelope:
 *   { "type": <TRANSFER_MSG>, "payload": { ... } }
 *
 * NOTE: These message types are LOCAL to the data channel only. They are
 * completely separate from the WebSocket signaling envelope in protocol.js —
 * don't mix them up.
 */

// ─── Transfer message types ───────────────────────────────────────────────────

export const TRANSFER_MSG = /** @type {const} */ ({
  /** Sender → Receiver: announces a new file, always first. */
  FILE_META: 'file-meta',

  /** Sender → Receiver: all chunks sent, transfer is done. */
  FILE_END: 'file-end',

  /** Either side → other: transfer aborted, discard partial data. */
  CANCEL: 'cancel',

  /**
   * Receiver → Sender: "I already have N bytes; please resume from offset N."
   * Sent when a data channel is re-established mid-transfer.
   * Payload: { transferId, offset }
   */
  RESUME_REQUEST: 'resume-request',

  /**
   * Sender → Receiver: "Acknowledged; resuming from offset N."
   * Payload: { transferId, offset }
   */
  RESUME_ACK: 'resume-ack',
});

// ─── Transfer status values ───────────────────────────────────────────────────

export const TRANSFER_STATUS = /** @type {const} */ ({
  PENDING: 'pending',
  TRANSFERRING: 'transferring',
  PAUSED: 'paused',
  COMPLETE: 'complete',
  CANCELLED: 'cancelled',
  INTEGRITY_MISMATCH: 'integrity-mismatch',
  ERROR: 'error',
  INTERRUPTED: 'transfer-interrupted', // channel closed mid-transfer
  RESUMING: 'resuming',                // reconnected; waiting for RESUME_ACK or re-sending
});

// ─── Size / backpressure constants ────────────────────────────────────────────

/** Chunk size for binary sends: 64 KB */
export const CHUNK_SIZE = 64 * 1024;

/**
 * Stop sending new chunks when bufferedAmount exceeds this value (256 KB).
 * Chosen as 4× CHUNK_SIZE so we keep a modest queue without flooding.
 */
export const BUFFER_HIGH_WATER = 256 * 1024;

/**
 * Resume sending when bufferedAmount drops below this value (64 KB).
 * Equals one chunk — resumes as soon as there's clearly room for more.
 */
export const BUFFER_LOW_WATER = 64 * 1024;

/** How long (ms) to poll bufferedAmount when waiting for drain. */
export const DRAIN_POLL_MS = 50;

// ─── Fallback (in-memory) size limits ────────────────────────────────────────

/**
 * Warn the user when the file is large enough to risk memory pressure in
 * the in-memory fallback path (Firefox / Safari).
 * 500 MB default — overridable via VITE_FALLBACK_WARN_BYTES at build time.
 */
export const FALLBACK_WARN_BYTES =
  parseInt(import.meta.env?.VITE_FALLBACK_WARN_BYTES, 10) || 500 * 1024 * 1024;

/**
 * Refuse the in-memory receive path above this size.
 * 2 GB default — at this point even a system with plenty of RAM will
 * likely OOM the tab trying to hold the whole file as a Blob array.
 */
export const FALLBACK_MAX_BYTES =
  parseInt(import.meta.env?.VITE_FALLBACK_MAX_BYTES, 10) || 2 * 1024 * 1024 * 1024;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Serialize a control message to send over the data channel.
 *
 * @param {string} type  One of TRANSFER_MSG values.
 * @param {object} payload
 * @returns {string}
 */
export function makeTransferMsg(type, payload) {
  return JSON.stringify({ type, payload });
}

/**
 * Parse an incoming data-channel message that is a string.
 * Returns null if it isn't a valid transfer control message.
 *
 * @param {string} raw
 * @returns {{ type: string, payload: object } | null}
 */
export function parseTransferMsg(raw) {
  try {
    const msg = JSON.parse(raw);
    if (
      msg === null ||
      typeof msg !== 'object' ||
      typeof msg.type !== 'string'
    ) return null;
    return msg;
  } catch {
    return null;
  }
}

/**
 * Format bytes as a human-readable string (KB / MB / GB).
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
