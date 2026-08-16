/**
 * Streaming SHA-256 hasher via SubtleCrypto.
 *
 * SubtleCrypto.digest() is a one-shot API — it doesn't natively stream. We
 * work around this by collecting ArrayBuffer chunks and digesting the
 * concatenated buffer at the end. For the send path, chunks arrive naturally
 * as we slice the file, so memory overhead equals at most one extra copy of
 * the file in ArrayBuffer form. For the receive path, the receiver already
 * holds the chunks anyway (or is writing them to disk), so we hash each
 * chunk as it arrives by maintaining a running list and finalising at the end.
 *
 * An alternative would be to use a JS SHA-256 implementation (e.g. js-sha256)
 * that supports a true streaming update/finalize API. We deliberately avoid
 * adding a dependency for this and instead use the platform crypto — the
 * final concatenate-and-digest approach is fast enough for files up to several
 * GB since the digest itself is a single native call, and we yield between
 * chunks during the send path anyway.
 *
 * Usage:
 *   const hasher = createHasher();
 *   hasher.update(chunk);    // call for each ArrayBuffer chunk
 *   const hex = await hasher.finalize();   // returns hex string
 */

/**
 * @typedef {{ update: (chunk: ArrayBuffer) => void, finalize: () => Promise<string> }} Hasher
 */

/**
 * Create a new streaming SHA-256 hasher.
 * All update() calls must complete before finalize() is called.
 *
 * @returns {Hasher}
 */
export function createHasher() {
  /** @type {ArrayBuffer[]} */
  const chunks = [];
  let totalBytes = 0;

  return {
    /**
     * Append a chunk to the hash accumulator.
     * @param {ArrayBuffer} chunk
     */
    update(chunk) {
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
    },

    /**
     * Finalise the hash and return a lowercase hex string.
     * @returns {Promise<string>}
     */
    async finalize() {
      // Concatenate all chunks into one buffer.
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }

      const hashBuffer = await crypto.subtle.digest('SHA-256', combined.buffer);
      return bufferToHex(hashBuffer);
    },
  };
}

/**
 * Compute SHA-256 of a File in one shot, yielding every N chunks so we
 * don't block the main thread on large files.
 *
 * Returns a lowercase hex string.
 *
 * @param {File} file
 * @param {number} [chunkSize=64*1024]
 * @returns {Promise<string>}
 */
export async function hashFile(file, chunkSize = 64 * 1024) {
  const hasher = createHasher();
  let offset = 0;

  while (offset < file.size) {
    const slice = file.slice(offset, offset + chunkSize);
    const buf = await slice.arrayBuffer();
    hasher.update(buf);
    offset += buf.byteLength;

    // Yield to the event loop every 64 chunks (~4 MB) to stay responsive.
    if ((offset / chunkSize) % 64 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  return hasher.finalize();
}

/**
 * Convert an ArrayBuffer to a lowercase hex string.
 *
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
export function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
