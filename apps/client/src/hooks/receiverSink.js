/**
 * receiverSink — abstraction over the two file-write paths.
 *
 * PRIMARY PATH   (Chrome / Edge / Opera — ~74% of users):
 *   window.showSaveFilePicker + WritableStream
 *   Chunks are written directly to disk as they arrive.
 *   No full-file accumulation in memory.
 *   Requires a user gesture to call showSaveFilePicker, so we open the picker
 *   as soon as we receive FILE_META (before the first chunk arrives).
 *
 * FALLBACK PATH  (Firefox / Safari — ~26% of users):
 *   In-memory Blob array accumulation.
 *   On file-end, a temporary object URL is created and a hidden <a> element
 *   is clicked to trigger the browser's native download dialog.
 *   Size limits:
 *     FALLBACK_WARN_BYTES  (default 500 MB) — warns but continues
 *     FALLBACK_MAX_BYTES   (default 2 GB)   — refuses, returns an error
 *
 * Usage:
 *   const sink = await openSink(meta);   // call on FILE_META
 *   await sink.write(arrayBuffer);       // call for each chunk
 *   await sink.close();                  // call on FILE_END
 *   sink.abort();                        // call on cancel / error
 */

import { FALLBACK_WARN_BYTES, FALLBACK_MAX_BYTES } from './transferProtocol.js';

/**
 * @typedef {{
 *   write: (chunk: ArrayBuffer) => Promise<void>,
 *   close: () => Promise<void>,
 *   abort: () => void,
 *   isStreaming: boolean,   // true = FSAPI path, false = in-memory fallback
 *   warning: string | null, // non-null if fallback size warning was issued
 * }} ReceiverSink
 */

/**
 * Detect whether the File System Access API picker is available.
 * We check the function itself, not just the API object.
 *
 * @returns {boolean}
 */
export function isFsapiSupported() {
  return typeof window !== 'undefined' &&
    typeof window.showSaveFilePicker === 'function';
}

/**
 * Open a ReceiverSink for the incoming file described by `meta`.
 *
 * Must be called in a user-gesture context (the FILE_META message arrives
 * synchronously after the sender initiates, which is close enough for most
 * browsers; if the picker is blocked, we fall back automatically).
 *
 * @param {{ name: string, size: number, mimeType: string }} meta
 * @returns {Promise<ReceiverSink>}
 */
export async function openSink(meta) {
  // ── Size guard (fallback path only — FSAPI can handle any size the OS can) ──
  const willUseFallback = !isFsapiSupported();

  if (willUseFallback && meta.size > FALLBACK_MAX_BYTES) {
    throw new Error(
      `File is too large for in-memory receive (${(meta.size / (1024 ** 3)).toFixed(1)} GB). ` +
      'Use Chrome or Edge for files over 2 GB.',
    );
  }

  const warning =
    willUseFallback && meta.size > FALLBACK_WARN_BYTES
      ? `Large file (${(meta.size / (1024 ** 2)).toFixed(0)} MB) will be held in memory ` +
        'until download completes. Use Chrome or Edge to avoid memory pressure.'
      : null;

  // ── PRIMARY: File System Access API ──────────────────────────────────────────
  if (!willUseFallback) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: meta.name,
        types: meta.mimeType
          ? [{ description: 'File', accept: { [meta.mimeType]: [] } }]
          : undefined,
      });
      const writable = await handle.createWritable();

      return {
        isStreaming: true,
        warning: null,
        async write(chunk) {
          await writable.write(chunk);
        },
        async close() {
          await writable.close();
        },
        abort() {
          writable.abort().catch(() => {/* ignore */});
        },
      };
    } catch (err) {
      // User dismissed the picker, or a permissions error — fall through to
      // the in-memory path rather than hard-failing.
      if (err.name === 'AbortError') {
        throw err; // User explicitly cancelled — propagate.
      }
      // Any other FSAPI error: silently fall through to in-memory fallback.
      console.warn('[receiverSink] FSAPI unavailable, using fallback:', err.message);
    }
  }

  // ── FALLBACK: in-memory Blob accumulation ─────────────────────────────────

  /** @type {ArrayBuffer[]} */
  const chunks = [];
  let aborted = false;

  return {
    isStreaming: false,
    warning,
    async write(chunk) {
      if (!aborted) chunks.push(chunk);
    },
    async close() {
      if (aborted) return;
      const blob = new Blob(chunks, { type: meta.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Small delay before cleanup so the browser has time to start the download.
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    },
    abort() {
      aborted = true;
      chunks.length = 0; // release memory immediately
    },
  };
}
