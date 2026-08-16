/**
 * useFileTransfer tests.
 *
 * Strategy:
 *   - Mock openSink (receiverSink.js) so we never touch the real FSAPI or DOM.
 *   - Mock SubtleCrypto so SHA-256 is synchronously controllable.
 *   - Build a fake RTCDataChannel with controllable bufferedAmount + events.
 *   - Use renderHook + act; drive the channel via dispatchEvent / direct calls.
 *
 * Scenarios covered:
 *   1. Successful send + receive round-trip (hash matches)
 *   2. Integrity mismatch on FILE_END
 *   3. Receiver cancel mid-transfer
 *   4. Sender cancel mid-transfer
 *   5. Connection loss mid-transfer (channel closes) — both send and receive sides
 *   6. Backpressure: send loop pauses when bufferedAmount > HIGH_WATER
 *   7. Fallback sink size-guard: refuses files above FALLBACK_MAX_BYTES
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileTransfer } from '../hooks/useFileTransfer.js';
import {
  TRANSFER_MSG,
  TRANSFER_STATUS,
  BUFFER_HIGH_WATER,
  makeTransferMsg,
} from '../hooks/transferProtocol.js';

// ─── Mock receiverSink ────────────────────────────────────────────────────────

// We mock the whole module so every openSink() call returns our controllable sink.
vi.mock('../hooks/receiverSink.js', () => {
  const makeSink = () => ({
    isStreaming: false,
    warning: null,
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
  });

  return {
    isFsapiSupported: vi.fn().mockReturnValue(false),
    openSink: vi.fn().mockImplementation(async () => makeSink()),
  };
});

// ─── SubtleCrypto mock ────────────────────────────────────────────────────────
// global.crypto is a read-only getter in jsdom — we can't reassign it.
// Instead we spy on crypto.subtle.digest in-place.

const FIXED_HASH_BYTES = new Uint8Array(32).fill(0xab);
const FIXED_HASH_HEX = 'ab'.repeat(32);

let digestSpy;
beforeEach(() => {
  // jsdom exposes crypto.subtle; spy on digest so hashes are predictable.
  digestSpy = vi
    .spyOn(crypto.subtle, 'digest')
    .mockResolvedValue(FIXED_HASH_BYTES.buffer.slice(0));
});

// ─── Mock File factory ────────────────────────────────────────────────────────

function makeMockFile(name = 'test.txt', sizeBytes = 100, content = null) {
  const data = content ?? new Uint8Array(sizeBytes).fill(0x42);
  const blob = new Blob([data]);
  const file = new File([blob], name, { type: 'text/plain' });
  return file;
}

// ─── Mock RTCDataChannel factory ─────────────────────────────────────────────

function makeMockDc() {
  const listeners = {};

  const dc = {
    readyState: 'open',
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((evt, fn) => {
      listeners[evt] = listeners[evt] ?? [];
      listeners[evt].push(fn);
    }),
    removeEventListener: vi.fn((evt, fn) => {
      if (listeners[evt]) {
        listeners[evt] = listeners[evt].filter((f) => f !== fn);
      }
    }),
    // Test helper: fire a synthetic event.
    _emit(type, data) {
      (listeners[type] ?? []).forEach((fn) => fn(data));
    },
  };

  return dc;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate the receiver side receiving a string message. */
function receiveString(dc, str) {
  act(() => { dc._emit('message', { data: str }); });
}

/** Simulate the receiver side receiving a binary chunk. */
function receiveBinary(dc, buf) {
  act(() => { dc._emit('message', { data: buf }); });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useFileTransfer', () => {
  let mockDc;

  beforeEach(async () => {
    mockDc = makeMockDc();
    const { openSink } = await import('../hooks/receiverSink.js');
    openSink.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    digestSpy?.mockRestore();
  });

  // ── 1. Hook mounts with empty transfers ──────────────────────────────────────

  it('starts with an empty transfers array', () => {
    const { result } = renderHook(() => useFileTransfer(mockDc));
    expect(result.current.transfers).toEqual([]);
  });

  // ── 2. Successful send ────────────────────────────────────────────────────────

  it('send: transitions through pending → transferring → complete', async () => {
    const { result } = renderHook(() => useFileTransfer(mockDc));
    const file = makeMockFile('hello.txt', 64);

    await act(async () => {
      result.current.sendFile(file);
      // Let all microtasks/promises resolve.
      await new Promise((r) => setTimeout(r, 50));
    });

    const transfers = result.current.transfers;
    expect(transfers).toHaveLength(1);
    expect(transfers[0].status).toBe(TRANSFER_STATUS.COMPLETE);
    expect(transfers[0].direction).toBe('send');
    expect(transfers[0].progress).toBe(1);
  });

  it('send: emits FILE_META before any binary chunks', async () => {
    const { result } = renderHook(() => useFileTransfer(mockDc));
    const file = makeMockFile('doc.pdf', 128);

    await act(async () => {
      result.current.sendFile(file);
      await new Promise((r) => setTimeout(r, 50));
    });

    const calls = mockDc.send.mock.calls;
    // First call must be the FILE_META string.
    expect(typeof calls[0][0]).toBe('string');
    const meta = JSON.parse(calls[0][0]);
    expect(meta.type).toBe(TRANSFER_MSG.FILE_META);
    expect(meta.payload.name).toBe('doc.pdf');
    expect(meta.payload.size).toBe(128);
  });

  it('send: last message is FILE_END with sha256 hash', async () => {
    const { result } = renderHook(() => useFileTransfer(mockDc));
    const file = makeMockFile('data.bin', 64);

    await act(async () => {
      result.current.sendFile(file);
      await new Promise((r) => setTimeout(r, 50));
    });

    const calls = mockDc.send.mock.calls;
    const last = JSON.parse(calls[calls.length - 1][0]);
    expect(last.type).toBe(TRANSFER_MSG.FILE_END);
    expect(last.payload.sha256).toBe(FIXED_HASH_HEX);
  });

  // ── 3. Successful receive — hash matches ──────────────────────────────────────

  it('receive: transitions through pending → transferring → complete on matching hash', async () => {
    const { result } = renderHook(() => useFileTransfer(mockDc));

    const metaMsg = makeTransferMsg(TRANSFER_MSG.FILE_META, {
      transferId: 'tx-1',
      name: 'file.txt',
      size: 10,
      mimeType: 'text/plain',
    });

    await act(async () => {
      receiveString(mockDc, metaMsg);
      await new Promise((r) => setTimeout(r, 20));
    });

    // Send a binary chunk.
    const chunk = new Uint8Array(10).fill(0x01).buffer;
    await act(async () => {
      receiveBinary(mockDc, chunk);
      await new Promise((r) => setTimeout(r, 10));
    });

    // Send FILE_END with the hash that our mock SubtleCrypto will produce.
    const endMsg = makeTransferMsg(TRANSFER_MSG.FILE_END, {
      transferId: 'tx-1',
      sha256: FIXED_HASH_HEX,
    });

    await act(async () => {
      receiveString(mockDc, endMsg);
      await new Promise((r) => setTimeout(r, 20));
    });

    const t = result.current.transfers[0];
    expect(t.status).toBe(TRANSFER_STATUS.COMPLETE);
    expect(t.direction).toBe('receive');
    expect(t.progress).toBe(1);
  });

  // ── 4. Integrity mismatch ─────────────────────────────────────────────────────

  it('receive: lands in integrity-mismatch when hashes differ', async () => {
    const { result } = renderHook(() => useFileTransfer(mockDc));

    const metaMsg = makeTransferMsg(TRANSFER_MSG.FILE_META, {
      transferId: 'tx-bad',
      name: 'corrupt.bin',
      size: 8,
      mimeType: 'application/octet-stream',
    });

    await act(async () => {
      receiveString(mockDc, metaMsg);
      await new Promise((r) => setTimeout(r, 20));
    });

    const chunk = new Uint8Array(8).buffer;
    await act(async () => {
      receiveBinary(mockDc, chunk);
      await new Promise((r) => setTimeout(r, 10));
    });

    // Send FILE_END with a WRONG hash.
    const wrongHash = 'de'.repeat(32);
    const endMsg = makeTransferMsg(TRANSFER_MSG.FILE_END, {
      transferId: 'tx-bad',
      sha256: wrongHash,
    });

    await act(async () => {
      receiveString(mockDc, endMsg);
      await new Promise((r) => setTimeout(r, 20));
    });

    const t = result.current.transfers[0];
    expect(t.status).toBe(TRANSFER_STATUS.INTEGRITY_MISMATCH);
    expect(t.error).toMatch(/integrity check failed/i);
    // integrity-mismatch is distinct from error and from complete.
    expect(t.status).not.toBe(TRANSFER_STATUS.ERROR);
    expect(t.status).not.toBe(TRANSFER_STATUS.COMPLETE);
  });

  // ── 5. Receiver cancel mid-transfer ──────────────────────────────────────────

  it('receive: cancelTransfer aborts the sink and marks cancelled', async () => {
    const { openSink } = await import('../hooks/receiverSink.js');
    const sink = {
      isStreaming: false,
      warning: null,
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
    };
    openSink.mockResolvedValueOnce(sink);

    const { result } = renderHook(() => useFileTransfer(mockDc));

    const metaMsg = makeTransferMsg(TRANSFER_MSG.FILE_META, {
      transferId: 'tx-cancel',
      name: 'bigfile.zip',
      size: 1000,
      mimeType: 'application/zip',
    });

    await act(async () => {
      receiveString(mockDc, metaMsg);
      await new Promise((r) => setTimeout(r, 20));
    });

    const transferId = result.current.transfers[0].id;

    await act(async () => {
      result.current.cancelTransfer(transferId);
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.transfers[0].status).toBe(TRANSFER_STATUS.CANCELLED);
    expect(sink.abort).toHaveBeenCalledOnce();
  });

  // ── 6. Sender cancel mid-transfer ────────────────────────────────────────────

  it('send: cancelTransfer during send emits CANCEL message and marks cancelled', async () => {
    const { result } = renderHook(() => useFileTransfer(mockDc));
    // Use a 1 MB file so the loop doesn't finish before we cancel.
    const file = makeMockFile('large.bin', 1024 * 1024);

    let transferId;
    act(() => {
      transferId = result.current.sendFile(file);
    });

    // Cancel on next tick (before loop finishes).
    await act(async () => {
      result.current.cancelTransfer(transferId);
      await new Promise((r) => setTimeout(r, 80));
    });

    const t = result.current.transfers.find((x) => x.id === transferId);
    expect(t.status).toBe(TRANSFER_STATUS.CANCELLED);

    // Should have sent a CANCEL envelope.
    const cancelCalls = mockDc.send.mock.calls
      .filter((c) => typeof c[0] === 'string')
      .map((c) => JSON.parse(c[0]))
      .filter((m) => m.type === TRANSFER_MSG.CANCEL);
    expect(cancelCalls.length).toBeGreaterThan(0);
  });

  // ── 7. Connection loss mid-transfer (receive side) ────────────────────────────

  it('receive: channel close mid-transfer lands in transfer-interrupted', async () => {
    const { result } = renderHook(() => useFileTransfer(mockDc));

    const metaMsg = makeTransferMsg(TRANSFER_MSG.FILE_META, {
      transferId: 'tx-loss',
      name: 'stream.mp4',
      size: 5000,
      mimeType: 'video/mp4',
    });

    await act(async () => {
      receiveString(mockDc, metaMsg);
      await new Promise((r) => setTimeout(r, 20));
    });

    // Simulate channel closing.
    await act(async () => {
      mockDc._emit('close', {});
      await new Promise((r) => setTimeout(r, 10));
    });

    const t = result.current.transfers[0];
    expect(t.status).toBe(TRANSFER_STATUS.INTERRUPTED);
    expect(t.error).toMatch(/connection interrupted|connection lost/i);
  });

  // ── 8. Connection loss mid-transfer (send side) ───────────────────────────────

  it('send: channel close mid-transfer lands in transfer-interrupted', async () => {
    const { result } = renderHook(() => useFileTransfer(mockDc));
    const file = makeMockFile('video.mp4', 1024 * 1024);

    // Mark channel as closed immediately so the send loop's readyState check
    // fails on the first iteration, before the loop can finish.
    mockDc.readyState = 'closed';

    let transferId;
    act(() => {
      // sendFile checks readyState before starting — temporarily reopen it.
      mockDc.readyState = 'open';
      transferId = result.current.sendFile(file);
      // Now immediately close it so the first loop iteration sees it closed.
      mockDc.readyState = 'closed';
    });

    await act(async () => {
      mockDc._emit('close', {});
      await new Promise((r) => setTimeout(r, 80));
    });

    const t = result.current.transfers.find((x) => x.id === transferId);
    expect(t.status).toBe(TRANSFER_STATUS.INTERRUPTED);
  });

  // ── 9. Backpressure: high-water mark pauses the send loop ─────────────────────

  it('send: does not crash when bufferedAmount exceeds HIGH_WATER', async () => {
    // Set bufferedAmount above the high-water mark so the loop must wait.
    // After a short delay, drop it below LOW_WATER to let it proceed.
    mockDc.bufferedAmount = BUFFER_HIGH_WATER + 1;

    setTimeout(() => {
      mockDc.bufferedAmount = 0;
    }, 60);

    const { result } = renderHook(() => useFileTransfer(mockDc));
    const file = makeMockFile('backpressure.bin', 64);

    await act(async () => {
      result.current.sendFile(file);
      await new Promise((r) => setTimeout(r, 200));
    });

    const t = result.current.transfers[0];
    // Should complete after drain, not error or get stuck.
    expect(t.status).toBe(TRANSFER_STATUS.COMPLETE);
  });

  // ── 10. Fallback sink refuses oversized files ─────────────────────────────────

  it('receive: refuses a file above FALLBACK_MAX_BYTES when FSAPI unavailable', async () => {
    // Override openSink to throw the size-guard error.
    const { openSink } = await import('../hooks/receiverSink.js');
    openSink.mockRejectedValueOnce(
      new Error('File is too large for in-memory receive (2.1 GB). Use Chrome or Edge for files over 2 GB.'),
    );

    const { result } = renderHook(() => useFileTransfer(mockDc));

    const metaMsg = makeTransferMsg(TRANSFER_MSG.FILE_META, {
      transferId: 'tx-huge',
      name: 'movie.mkv',
      size: 2.1 * 1024 * 1024 * 1024,
      mimeType: 'video/x-matroska',
    });

    await act(async () => {
      receiveString(mockDc, metaMsg);
      await new Promise((r) => setTimeout(r, 30));
    });

    const t = result.current.transfers[0];
    expect(t.status).toBe(TRANSFER_STATUS.ERROR);
    expect(t.error).toMatch(/too large/i);
  });

  // ── 11. Peer CANCEL message lands in cancelled ────────────────────────────────

  it('receive: CANCEL from sender marks transfer cancelled', async () => {
    const { result } = renderHook(() => useFileTransfer(mockDc));

    const metaMsg = makeTransferMsg(TRANSFER_MSG.FILE_META, {
      transferId: 'tx-peer-cancel',
      name: 'aborted.zip',
      size: 9999,
      mimeType: 'application/zip',
    });

    await act(async () => {
      receiveString(mockDc, metaMsg);
      await new Promise((r) => setTimeout(r, 20));
    });

    const cancelMsg = makeTransferMsg(TRANSFER_MSG.CANCEL, {
      transferId: 'tx-peer-cancel',
      reason: 'sender-cancelled',
    });

    await act(async () => {
      receiveString(mockDc, cancelMsg);
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.transfers[0].status).toBe(TRANSFER_STATUS.CANCELLED);
  });

  // ── 12. sendFile throws when channel is not open ──────────────────────────────

  it('sendFile throws when data channel is null', () => {
    const { result } = renderHook(() => useFileTransfer(null));
    expect(() => result.current.sendFile(makeMockFile())).toThrow(/no open data channel/i);
  });

  it('sendFile throws when data channel is not in open state', () => {
    mockDc.readyState = 'connecting';
    const { result } = renderHook(() => useFileTransfer(mockDc));
    expect(() => result.current.sendFile(makeMockFile())).toThrow(/no open data channel/i);
  });
});

// ─── fileHasher unit tests ────────────────────────────────────────────────────

describe('fileHasher', () => {
  it('createHasher: finalize returns a 64-char hex string', async () => {
    const { createHasher } = await import('../hooks/fileHasher.js');
    const hasher = createHasher();
    hasher.update(new Uint8Array([1, 2, 3]).buffer);
    const hex = await hasher.finalize();
    // Our mock returns 32 bytes of 0xab.
    expect(hex).toBe(FIXED_HASH_HEX);
    expect(hex).toHaveLength(64);
  });

  it('createHasher: finalize with no chunks still works', async () => {
    const { createHasher } = await import('../hooks/fileHasher.js');
    const hasher = createHasher();
    const hex = await hasher.finalize();
    expect(typeof hex).toBe('string');
    expect(hex).toHaveLength(64);
  });

  it('bufferToHex: converts correctly', async () => {
    const { bufferToHex } = await import('../hooks/fileHasher.js');
    const buf = new Uint8Array([0x00, 0xff, 0x10, 0xab]).buffer;
    expect(bufferToHex(buf)).toBe('00ff10ab');
  });
});

// ─── transferProtocol unit tests ─────────────────────────────────────────────

describe('transferProtocol', () => {
  it('makeTransferMsg / parseTransferMsg round-trip', async () => {
    const { makeTransferMsg, parseTransferMsg, TRANSFER_MSG } =
      await import('../hooks/transferProtocol.js');
    const raw = makeTransferMsg(TRANSFER_MSG.FILE_META, { name: 'x', size: 1 });
    const parsed = parseTransferMsg(raw);
    expect(parsed.type).toBe(TRANSFER_MSG.FILE_META);
    expect(parsed.payload.name).toBe('x');
  });

  it('parseTransferMsg returns null on invalid JSON', async () => {
    const { parseTransferMsg } = await import('../hooks/transferProtocol.js');
    expect(parseTransferMsg('not json')).toBeNull();
    expect(parseTransferMsg('{}')).toBeNull(); // no type field
  });

  it('formatBytes formats sizes correctly', async () => {
    const { formatBytes } = await import('../hooks/transferProtocol.js');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.50 GB');
  });
});
