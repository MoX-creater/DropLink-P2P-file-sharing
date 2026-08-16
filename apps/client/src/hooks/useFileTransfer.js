/**
 * useFileTransfer
 *
 * Consumes the RTCDataChannel from usePeerConnection and implements the full
 * file-transfer engine: chunked send, streaming receive, SHA-256 integrity
 * verification, backpressure control, pause/resume/cancel, and
 * resume-after-reconnect.
 *
 * Resume-after-reconnect (Phase 4):
 *   When usePeerConnection re-establishes a data channel after a transient
 *   drop (ICE restart), it passes the new channel via the dataChannel prop.
 *   useFileTransfer detects the change and drives a RESUME_REQUEST / RESUME_ACK
 *   handshake before resuming chunk delivery from the last known offset.
 *
 *   Receive side:  sends RESUME_REQUEST { transferId, offset: bytesReceived }
 *   Send side:     receives RESUME_REQUEST, seeks to requested offset, sends
 *                  RESUME_ACK, then re-enters the send loop from that offset.
 *
 *   If usePeerConnection calls onReconnectFailedRef (timeout / hard fail),
 *   in-flight transfers are moved to INTERRUPTED and partial state is discarded.
 *
 * PUBLIC API (unchanged from Phase 3):
 *   const {
 *     transfers,         // TransferState[]
 *     sendFile,          // (file: File) => string  transferId
 *     cancelTransfer,    // (transferId: string) => void
 *     pauseTransfer,     // (transferId: string) => void
 *     resumeTransfer,    // (transferId: string) => void
 *   } = useFileTransfer(dataChannel, onReconnectFailedRef?);
 *
 * TransferState shape adds:
 *   resumeOffset: number  // last byte confirmed by RESUME_ACK (0 if no resume)
 *
 * Data-channel framing (transferProtocol.js):
 *   string  → JSON { type, payload }
 *   binary  → raw ArrayBuffer chunk
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  TRANSFER_MSG,
  TRANSFER_STATUS,
  CHUNK_SIZE,
  BUFFER_HIGH_WATER,
  BUFFER_LOW_WATER,
  DRAIN_POLL_MS,
  makeTransferMsg,
  parseTransferMsg,
} from './transferProtocol.js';
import { createHasher } from './fileHasher.js';
import { openSink } from './receiverSink.js';

// ─── ID generator ─────────────────────────────────────────────────────────────

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Speed tracking ───────────────────────────────────────────────────────────

function createSpeedTracker() {
  const samples = [];
  return {
    record(bytes) {
      samples.push({ ts: Date.now(), bytes });
      const cutoff = Date.now() - 1000;
      while (samples.length > 0 && samples[0].ts < cutoff) samples.shift();
    },
    getSpeedBps() {
      if (samples.length === 0) return 0;
      const total = samples.reduce((s, x) => s + x.bytes, 0);
      const span = (Date.now() - samples[0].ts) || 1;
      return Math.round((total / span) * 1000);
    },
    reset() { samples.length = 0; },
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param {RTCDataChannel | null} dataChannel
 * @param {React.MutableRefObject<(() => void) | null> | null} [onReconnectFailedRef]
 *   Ref from usePeerConnection — we register our cleanup callback into it so
 *   we are notified when reconnection times out.
 */
export function useFileTransfer(dataChannel, onReconnectFailedRef = null) {
  const [transferMap, setTransferMap] = useState(() => new Map());

  // sendStateRef fields:
  //   id, file, offset, paused, cancelled, hasher, speed, waitingForResumeAck
  const sendStateRef = useRef(null);

  // receiveStateRef fields:
  //   id, meta, bytesReceived, hasher, sink, speed
  const receiveStateRef = useRef(null);

  // ── State helpers ──────────────────────────────────────────────────────────

  const updateTransfer = useCallback((id, patch) => {
    setTransferMap((prev) => {
      const next = new Map(prev);
      const existing = next.get(id);
      if (!existing) return prev;
      next.set(id, { ...existing, ...patch });
      return next;
    });
  }, []);

  const addTransfer = useCallback((transfer) => {
    setTransferMap((prev) => {
      const next = new Map(prev);
      next.set(transfer.id, transfer);
      return next;
    });
  }, []);

  // ── Backpressure drain ─────────────────────────────────────────────────────

  function waitForDrain(dc) {
    return new Promise((resolve) => {
      function check() {
        if (!dc || dc.readyState !== 'open') { resolve(false); return; }
        if (dc.bufferedAmount <= BUFFER_LOW_WATER) { resolve(true); return; }
        setTimeout(check, DRAIN_POLL_MS);
      }
      check();
    });
  }

  // ── Send path ──────────────────────────────────────────────────────────────

  const sendFile = useCallback((file) => {
    if (!dataChannel || dataChannel.readyState !== 'open') {
      throw new Error('No open data channel — connect to a peer first');
    }

    const id = newId();
    const speed = createSpeedTracker();
    const hasher = createHasher();

    addTransfer({
      id,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      direction: 'send',
      status: TRANSFER_STATUS.PENDING,
      bytesTransferred: 0,
      progress: 0,
      speedBps: 0,
      resumeOffset: 0,
      error: null,
      sinkWarning: null,
    });

    sendStateRef.current = {
      id,
      file,
      offset: 0,
      paused: false,
      cancelled: false,
      interrupted: false,   // set by handleChannelInterrupt; stops the loop
      waitingForResumeAck: false,
      hasher,
      speed,
    };

    runSendLoop(id, file, dataChannel, 0).catch((err) => {
      updateTransfer(id, { status: TRANSFER_STATUS.ERROR, error: err.message });
    });

    return id;
  }, [dataChannel, addTransfer, updateTransfer]);

  /**
   * Core send loop.  `startOffset` allows resuming mid-file after reconnect.
   *
   * @param {string} id
   * @param {File} file
   * @param {RTCDataChannel} dc
   * @param {number} startOffset  Byte offset to start/resume from.
   */
  async function runSendLoop(id, file, dc, startOffset) {
    const state = sendStateRef.current;
    if (!state || state.id !== id) return;

    // Yield one microtask so any synchronous close/interrupt events that were
    // dispatched in the same tick as sendFile() can set state.interrupted
    // before we overwrite the status with TRANSFERRING.
    await Promise.resolve();

    // Bail immediately if the channel was closed before we even started.
    if (state.interrupted) return;

    updateTransfer(id, { status: TRANSFER_STATUS.TRANSFERRING });

    // Only send FILE_META for a fresh start (offset 0).
    if (startOffset === 0) {      dc.send(makeTransferMsg(TRANSFER_MSG.FILE_META, {
        transferId: id,
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
      }));
    }

    let offset = startOffset;

    while (offset < file.size) {
      // Interrupt gate — handleChannelInterrupt flagged us; stop the loop.
      // The transfer is already marked INTERRUPTED; don't overwrite that.
      if (state.interrupted) {
        return;
      }

      // Cancel gate.
      if (state.cancelled) {        if (dc.readyState === 'open') {
          dc.send(makeTransferMsg(TRANSFER_MSG.CANCEL, { transferId: id, reason: 'sender-cancelled' }));
        }
        updateTransfer(id, { status: TRANSFER_STATUS.CANCELLED });
        sendStateRef.current = null;
        return;
      }

      // Pause gate.
      if (state.paused) {
        updateTransfer(id, { status: TRANSFER_STATUS.PAUSED });
        await new Promise((resolve) => {
          const poll = setInterval(() => {
            const s = sendStateRef.current;
            if (!s || s.id !== id || !s.paused || s.cancelled) {
              clearInterval(poll);
              resolve();
            }
          }, 100);
        });
        if (sendStateRef.current?.cancelled) continue;
        updateTransfer(id, { status: TRANSFER_STATUS.TRANSFERRING });
      }

      // Backpressure gate.
      if (dc.bufferedAmount > BUFFER_HIGH_WATER) {
        const drained = await waitForDrain(dc);
        if (!drained) {
          // Channel closed — handleChannelClose() will set INTERRUPTED.
          // Save the current offset so a resume can pick it up.
          state.offset = offset;
          sendStateRef.current = state; // keep alive for potential resume
          return;
        }
      }

      if (dc.readyState !== 'open') {
        state.offset = offset;
        sendStateRef.current = state;
        return;
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();

      state.hasher.update(buffer);
      dc.send(buffer);
      offset += buffer.byteLength;
      state.offset = offset; // keep in sync for resume snapshot

      state.speed.record(buffer.byteLength);
      updateTransfer(id, {
        bytesTransferred: offset,
        progress: file.size > 0 ? offset / file.size : 1,
        speedBps: state.speed.getSpeedBps(),
        status: TRANSFER_STATUS.TRANSFERRING,
      });
    }

    const hash = await state.hasher.finalize();
    dc.send(makeTransferMsg(TRANSFER_MSG.FILE_END, { transferId: id, sha256: hash }));

    updateTransfer(id, { status: TRANSFER_STATUS.COMPLETE, progress: 1, speedBps: 0 });
    sendStateRef.current = null;
  }

  // ── Receive path ───────────────────────────────────────────────────────────

  const handleMessage = useCallback(async (evt) => {
    // Binary chunk.
    if (evt.data instanceof ArrayBuffer) {
      const rx = receiveStateRef.current;
      if (!rx) return;

      const buf = evt.data;
      rx.hasher.update(buf);
      rx.bytesReceived += buf.byteLength;
      rx.speed.record(buf.byteLength);

      try {
        await rx.sink.write(buf);
      } catch (err) {
        rx.sink.abort();
        updateTransfer(rx.id, { status: TRANSFER_STATUS.ERROR, error: err.message });
        receiveStateRef.current = null;
        return;
      }

      const progress = rx.meta.size > 0 ? rx.bytesReceived / rx.meta.size : 0;
      updateTransfer(rx.id, {
        bytesTransferred: rx.bytesReceived,
        progress,
        speedBps: rx.speed.getSpeedBps(),
      });
      return;
    }

    if (typeof evt.data !== 'string') return;

    const msg = parseTransferMsg(evt.data);
    if (!msg) return;

    const { type, payload } = msg;

    // ── FILE_META ───────────────────────────────────────────────────────────
    if (type === TRANSFER_MSG.FILE_META) {
      const id = newId();
      const meta = {
        name: payload.name,
        size: payload.size,
        mimeType: payload.mimeType || 'application/octet-stream',
      };

      addTransfer({
        id,
        name: meta.name,
        size: meta.size,
        mimeType: meta.mimeType,
        direction: 'receive',
        status: TRANSFER_STATUS.PENDING,
        bytesTransferred: 0,
        progress: 0,
        speedBps: 0,
        resumeOffset: 0,
        error: null,
        sinkWarning: null,
      });

      let sink;
      try {
        sink = await openSink(meta);
      } catch (err) {
        updateTransfer(id, { status: TRANSFER_STATUS.ERROR, error: err.message });
        return;
      }

      receiveStateRef.current = {
        id,
        meta,
        bytesReceived: 0,
        hasher: createHasher(),
        sink,
        speed: createSpeedTracker(),
      };

      updateTransfer(id, { status: TRANSFER_STATUS.TRANSFERRING, sinkWarning: sink.warning });
      return;
    }

    // ── FILE_END ────────────────────────────────────────────────────────────
    if (type === TRANSFER_MSG.FILE_END) {
      const rx = receiveStateRef.current;
      if (!rx) return;

      const receivedHash = await rx.hasher.finalize();
      const expectedHash = payload?.sha256;

      if (expectedHash && receivedHash !== expectedHash) {
        rx.sink.abort();
        updateTransfer(rx.id, {
          status: TRANSFER_STATUS.INTEGRITY_MISMATCH,
          error: `Integrity check failed — file may be corrupted (expected ${expectedHash.slice(0, 8)}…, got ${receivedHash.slice(0, 8)}…)`,
          progress: 1,
          speedBps: 0,
        });
        receiveStateRef.current = null;
        return;
      }

      try {
        await rx.sink.close();
      } catch (err) {
        updateTransfer(rx.id, { status: TRANSFER_STATUS.ERROR, error: err.message });
        receiveStateRef.current = null;
        return;
      }

      updateTransfer(rx.id, { status: TRANSFER_STATUS.COMPLETE, progress: 1, speedBps: 0 });
      receiveStateRef.current = null;
      return;
    }

    // ── CANCEL ──────────────────────────────────────────────────────────────
    if (type === TRANSFER_MSG.CANCEL) {
      const rx = receiveStateRef.current;
      if (rx) {
        rx.sink.abort();
        updateTransfer(rx.id, { status: TRANSFER_STATUS.CANCELLED });
        receiveStateRef.current = null;
      }
      return;
    }

    // ── RESUME_REQUEST (received by sender after reconnect) ─────────────────
    if (type === TRANSFER_MSG.RESUME_REQUEST) {
      const tx = sendStateRef.current;
      if (!tx) return;

      const requestedOffset = payload?.offset ?? 0;

      // Acknowledge and re-enter the send loop from the requested offset.
      // The data channel reference is the *current* one on evt.target.
      const dc = evt.target ?? dataChannel;
      if (!dc || dc.readyState !== 'open') return;

      // Reset the hasher so it only covers chunks from the resumed segment.
      tx.hasher = createHasher();
      tx.speed.reset();
      tx.offset = requestedOffset;
      tx.interrupted = false;       // clear so the new loop can run
      tx.waitingForResumeAck = false;

      dc.send(makeTransferMsg(TRANSFER_MSG.RESUME_ACK, {
        transferId: tx.id,
        offset: requestedOffset,
      }));

      updateTransfer(tx.id, {
        status: TRANSFER_STATUS.RESUMING,
        resumeOffset: requestedOffset,
        speedBps: 0,
      });

      runSendLoop(tx.id, tx.file, dc, requestedOffset).catch((err) => {
        updateTransfer(tx.id, { status: TRANSFER_STATUS.ERROR, error: err.message });
      });
      return;
    }

    // ── RESUME_ACK (received by receiver after reconnect) ───────────────────
    if (type === TRANSFER_MSG.RESUME_ACK) {
      const rx = receiveStateRef.current;
      if (!rx) return;

      const confirmedOffset = payload?.offset ?? 0;
      updateTransfer(rx.id, {
        status: TRANSFER_STATUS.RESUMING,
        resumeOffset: confirmedOffset,
        speedBps: 0,
      });
      // Receiver just waits; chunks will resume flowing from the sender.
      return;
    }
  }, [addTransfer, updateTransfer, dataChannel]);

  // ── Channel close / interruption ───────────────────────────────────────────

  /**
   * Called when the data channel closes unexpectedly.
   * Preserves sendState and receiveState so a reconnect can resume them.
   * Status is set to INTERRUPTED — the reconnect logic in usePeerConnection
   * may call back via onReconnectFailedRef if it times out.
   */
  const handleChannelInterrupt = useCallback(() => {
    const tx = sendStateRef.current;
    if (tx) {
      tx.interrupted = true;   // signals the send loop to stop on next iteration
      updateTransfer(tx.id, {
        status: TRANSFER_STATUS.INTERRUPTED,
        error: 'Connection interrupted — attempting to reconnect…',
        speedBps: 0,
      });
      // Keep sendStateRef.current alive — resumeAfterReconnect() will use it.
    }

    const rx = receiveStateRef.current;
    if (rx) {
      updateTransfer(rx.id, {
        status: TRANSFER_STATUS.INTERRUPTED,
        error: 'Connection interrupted — attempting to reconnect…',
        speedBps: 0,
      });
      // Keep receiveStateRef.current alive for the same reason.
    }
  }, [updateTransfer]);

  /**
   * Called by usePeerConnection when the reconnect window expires with no
   * recovery.  Discards partial transfer state and moves to final INTERRUPTED.
   */
  const handleReconnectFailed = useCallback(() => {
    const tx = sendStateRef.current;
    if (tx) {
      updateTransfer(tx.id, {
        status: TRANSFER_STATUS.INTERRUPTED,
        error: 'Connection could not be re-established',
        speedBps: 0,
      });
      sendStateRef.current = null;
    }

    const rx = receiveStateRef.current;
    if (rx) {
      rx.sink.abort();
      updateTransfer(rx.id, {
        status: TRANSFER_STATUS.INTERRUPTED,
        error: 'Connection could not be re-established',
        speedBps: 0,
      });
      receiveStateRef.current = null;
    }
  }, [updateTransfer]);

  // ── Resume-after-reconnect entry point ─────────────────────────────────────

  /**
   * Called implicitly when the `dataChannel` prop changes to a new open
   * channel (useEffect below).  Drives the RESUME_REQUEST / RESUME_ACK
   * handshake if there are in-flight transfers.
   *
   * @param {RTCDataChannel} newDc
   */
  const resumeAfterReconnect = useCallback((newDc) => {
    if (!newDc || newDc.readyState !== 'open') return;

    // Receive side: tell the sender where we left off.
    const rx = receiveStateRef.current;
    if (rx && rx.bytesReceived > 0) {
      newDc.send(makeTransferMsg(TRANSFER_MSG.RESUME_REQUEST, {
        transferId: rx.id,
        offset: rx.bytesReceived,
      }));
      updateTransfer(rx.id, { status: TRANSFER_STATUS.RESUMING, speedBps: 0 });
    }

    // Send side: wait for RESUME_REQUEST from the receiver (handled in handleMessage).
    const tx = sendStateRef.current;
    if (tx) {
      tx.waitingForResumeAck = true;
      updateTransfer(tx.id, { status: TRANSFER_STATUS.RESUMING, speedBps: 0 });
    }
  }, [updateTransfer]);

  // ── Wire / re-wire the data channel ────────────────────────────────────────

  const prevDcRef = useRef(null);

  useEffect(() => {
    if (!dataChannel) {
      // Channel gone — interrupt (but don't discard) in-flight transfers.
      handleChannelInterrupt();
      prevDcRef.current = null;
      return;
    }

    const isReconnect =
      prevDcRef.current !== null &&          // there was a previous channel
      prevDcRef.current !== dataChannel &&   // this is a different instance
      dataChannel.readyState === 'open';     // and it's already open

    prevDcRef.current = dataChannel;

    dataChannel.addEventListener('message', handleMessage);
    dataChannel.addEventListener('close', handleChannelInterrupt);
    dataChannel.addEventListener('error', handleChannelInterrupt);

    if (isReconnect) {
      resumeAfterReconnect(dataChannel);
    }

    return () => {
      dataChannel.removeEventListener('message', handleMessage);
      dataChannel.removeEventListener('close', handleChannelInterrupt);
      dataChannel.removeEventListener('error', handleChannelInterrupt);
    };
  }, [dataChannel, handleMessage, handleChannelInterrupt, resumeAfterReconnect]);

  // Register the reconnect-failed callback with usePeerConnection.
  useEffect(() => {
    if (onReconnectFailedRef) {
      onReconnectFailedRef.current = handleReconnectFailed;
      return () => { onReconnectFailedRef.current = null; };
    }
  }, [onReconnectFailedRef, handleReconnectFailed]);

  // ── Public control surface ─────────────────────────────────────────────────

  const cancelTransfer = useCallback((id) => {
    const tx = sendStateRef.current;
    if (tx && tx.id === id) {
      tx.cancelled = true;
      return;
    }
    const rx = receiveStateRef.current;
    if (rx && rx.id === id) {
      rx.sink.abort();
      updateTransfer(id, { status: TRANSFER_STATUS.CANCELLED });
      receiveStateRef.current = null;
      if (dataChannel?.readyState === 'open') {
        dataChannel.send(makeTransferMsg(TRANSFER_MSG.CANCEL, { transferId: id, reason: 'receiver-cancelled' }));
      }
    }
  }, [dataChannel, updateTransfer]);

  const pauseTransfer = useCallback((id) => {
    const tx = sendStateRef.current;
    if (tx && tx.id === id) tx.paused = true;
  }, []);

  const resumeTransfer = useCallback((id) => {
    const tx = sendStateRef.current;
    if (tx && tx.id === id) tx.paused = false;
  }, []);

  return {
    transfers: Array.from(transferMap.values()),
    sendFile,
    cancelTransfer,
    pauseTransfer,
    resumeTransfer,
  };
}
