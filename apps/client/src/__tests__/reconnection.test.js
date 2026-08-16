/**
 * Phase 4 reconnection tests.
 *
 * Tests the interaction between usePeerConnection's RECONNECTING state and
 * useFileTransfer's resume-after-reconnect logic.
 *
 * Strategy:
 *   - usePeerConnection tests: fake timers for the 5 s timeout; mock WS + PC.
 *   - useFileTransfer reconnect tests: simulate channel close → new channel
 *     open; verify RESUME_REQUEST/ACK handshake; verify partial state
 *     preserved on interrupt and discarded on reconnect-failed.
 *
 * What "preserved" means here:
 *   - Transfer stays in Map with INTERRUPTED status (not removed).
 *   - sendStateRef / receiveStateRef kept alive (not nulled) so resume works.
 *   - On reconnect-failed those refs ARE nulled and error message updated.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePeerConnection, CONNECTION_STATUS } from '../hooks/usePeerConnection.js';
import { useFileTransfer } from '../hooks/useFileTransfer.js';
import {
  TRANSFER_MSG,
  TRANSFER_STATUS,
  makeTransferMsg,
} from '../hooks/transferProtocol.js';
import { MSG_TYPES } from '../hooks/protocol.js';

// ─── Mock factories (match patterns from existing test files) ─────────────────

function makeMockWs() {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null, onmessage: null, onerror: null, onclose: null,
  };
}

function makeMockDc(readyState = 'open') {
  const listeners = {};
  const dc = {
    readyState,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null, onclose: null, onerror: null,
    addEventListener: vi.fn((evt, fn) => {
      listeners[evt] = listeners[evt] ?? [];
      listeners[evt].push(fn);
    }),
    removeEventListener: vi.fn((evt, fn) => {
      if (listeners[evt]) listeners[evt] = listeners[evt].filter((f) => f !== fn);
    }),
    // Fire an event. `payload` becomes evt.data (matches MessageEvent shape).
    _emit(type, payload) {
      const evt = payload instanceof ArrayBuffer
        ? { data: payload, target: dc }
        : (typeof payload === 'string')
          ? { data: payload, target: dc }
          : payload; // allow passing a raw event object for close/error
      (listeners[type] ?? []).forEach((fn) => fn(evt));
    },
  };
  return dc;
}

function makeMockPc(dc) {
  const pc = {
    _dc: dc,
    createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'sdp' }),
    createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'sdp' }),
    setLocalDescription: vi.fn().mockResolvedValue(undefined),
    setRemoteDescription: vi.fn().mockResolvedValue(undefined),
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
    createDataChannel: vi.fn().mockReturnValue(dc),
    restartIce: vi.fn(),
    close: vi.fn(),
    localDescription: { type: 'offer', sdp: 'sdp' },
    iceConnectionState: 'new',
    onicecandidate: null,
    oniceconnectionstatechange: null,
    ondatachannel: null,
  };
  return pc;
}

vi.mock('../hooks/receiverSink.js', () => ({
  isFsapiSupported: vi.fn().mockReturnValue(false),
  openSink: vi.fn().mockImplementation(async () => ({
    isStreaming: false,
    warning: null,
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
  })),
}));

const _FIXED_HASH_HEX = 'ab'.repeat(32);
let digestSpy;

beforeEach(() => {
  digestSpy = vi
    .spyOn(crypto.subtle, 'digest')
    .mockResolvedValue(new Uint8Array(32).fill(0xab).buffer.slice(0));
});

afterEach(() => {
  digestSpy?.mockRestore();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════════
// usePeerConnection — RECONNECTING state machine
// ═══════════════════════════════════════════════════════════════════════════════

describe('usePeerConnection reconnection', () => {
  let mockWs, mockDc, mockPc;

  beforeEach(() => {
    mockDc = makeMockDc('connecting');
    mockWs = makeMockWs();
    mockPc = makeMockPc(mockDc);

    const WsSpy = vi.fn().mockImplementation(class {
      // eslint-disable-next-line no-constructor-return
      constructor() { return mockWs; }
    });
    WsSpy.CONNECTING = 0; WsSpy.OPEN = 1; WsSpy.CLOSING = 2; WsSpy.CLOSED = 3;
    global.WebSocket = WsSpy;

    global.RTCPeerConnection = vi.fn().mockImplementation(class {
      // eslint-disable-next-line no-constructor-return
      constructor() { return mockPc; }
    });
    global.RTCSessionDescription = vi.fn().mockImplementation(class {
      constructor(init) { Object.assign(this, init); }
    });
    global.RTCIceCandidate = vi.fn().mockImplementation(class {
      constructor(init) { Object.assign(this, init); }
    });
  });

  /** Bring connection to CONNECTED state. */
  async function reachConnected(result) {
    act(() => { result.current.createRoom(); });
    act(() => { mockWs.onopen?.(); });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({
        type: MSG_TYPES.ROOM_JOINED,
        payload: { roomId: 'ABCD12', peerId: 'p1', isInitiator: true },
      })});
    });
    await act(async () => {
      mockWs.onmessage?.({ data: JSON.stringify({
        type: MSG_TYPES.PEER_JOINED,
        payload: { peerId: 'p2' },
      })});
      await Promise.resolve(); await Promise.resolve();
    });
    act(() => { mockPc._dc.onopen?.(); });

    expect(result.current.status).toBe(CONNECTION_STATUS.CONNECTED);
  }

  // ── 1. dc.onclose while CONNECTED → RECONNECTING ─────────────────────────────

  it('transitions to RECONNECTING when data channel closes unexpectedly from CONNECTED', async () => {
    const { result } = renderHook(() => usePeerConnection());
    await reachConnected(result);

    act(() => { mockPc._dc.onclose?.(); });

    expect(result.current.status).toBe(CONNECTION_STATUS.RECONNECTING);
  });

  // ── 2. restartIce() called on dc close ────────────────────────────────────────

  it('calls restartIce() when entering RECONNECTING', async () => {
    const { result } = renderHook(() => usePeerConnection());
    await reachConnected(result);

    act(() => { mockPc._dc.onclose?.(); });

    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    expect(mockPc.restartIce).toHaveBeenCalled();
  });

  // ── 3. Reconnect success: new dc.onopen → CONNECTED ──────────────────────────

  it('returns to CONNECTED when a new data channel opens during RECONNECTING', async () => {
    const { result } = renderHook(() => usePeerConnection());
    await reachConnected(result);

    act(() => { mockPc._dc.onclose?.(); });
    expect(result.current.status).toBe(CONNECTION_STATUS.RECONNECTING);

    // Simulate ICE recovery: new data channel arrives via ondatachannel.
    const newDc = makeMockDc('connecting');
    await act(async () => {
      mockPc.ondatachannel?.({ channel: newDc });
      await new Promise((r) => setTimeout(r, 0));
    });

    act(() => { newDc.onopen?.(); });

    expect(result.current.status).toBe(CONNECTION_STATUS.CONNECTED);
    expect(result.current.dataChannel).toBe(newDc);
  });

  // ── 4. Reconnect timeout → PEER_DISCONNECTED ─────────────────────────────────

  it('times out to PEER_DISCONNECTED after 5 s if no recovery', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });

    const { result } = renderHook(() => usePeerConnection());
    await reachConnected(result);

    act(() => { mockPc._dc.onclose?.(); });
    expect(result.current.status).toBe(CONNECTION_STATUS.RECONNECTING);

    // Advance past the 5 s timeout. Use async variant so pending microtasks
    // (the setStatus callbacks) flush before we assert.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001);
    });

    expect(result.current.status).toBe(CONNECTION_STATUS.PEER_DISCONNECTED);
    expect(result.current.error).toMatch(/timed out/i);
  });

  // ── 5. ICE failure during RECONNECTING → ICE_FAILED ──────────────────────────

  it('transitions to ICE_FAILED if ICE fails during RECONNECTING', async () => {
    const { result } = renderHook(() => usePeerConnection());
    await reachConnected(result);

    act(() => { mockPc._dc.onclose?.(); });

    act(() => {
      mockPc.iceConnectionState = 'failed';
      mockPc.oniceconnectionstatechange?.();
    });

    expect(result.current.status).toBe(CONNECTION_STATUS.ICE_FAILED);
  });

  // ── 6. peer-left during RECONNECTING → PEER_DISCONNECTED immediately ──────────

  it('transitions directly to PEER_DISCONNECTED on peer-left during RECONNECTING', async () => {
    const { result } = renderHook(() => usePeerConnection());
    await reachConnected(result);

    act(() => { mockPc._dc.onclose?.(); });
    expect(result.current.status).toBe(CONNECTION_STATUS.RECONNECTING);

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({
        type: MSG_TYPES.PEER_LEFT,
        payload: { reason: 'peer-disconnected' },
      })});
    });

    expect(result.current.status).toBe(CONNECTION_STATUS.PEER_DISCONNECTED);
  });

  // ── 7. RECONNECTING not entered if dc was never open (not mid-transfer) ────────

  it('goes straight to PEER_DISCONNECTED if dc closes before ever being CONNECTED', async () => {
    const { result } = renderHook(() => usePeerConnection());
    act(() => { result.current.createRoom(); });
    act(() => { mockWs.onopen?.(); });

    act(() => {
      mockWs.onmessage?.({ data: JSON.stringify({
        type: MSG_TYPES.ROOM_JOINED,
        payload: { roomId: 'ABCD12', peerId: 'p1', isInitiator: false, existingPeerId: 'p2' },
      })});
    });

    // dc closes before onopen fires (was never CONNECTED).
    act(() => { mockPc._dc.onclose?.(); });

    // Should NOT be RECONNECTING since wasConnected is false.
    expect(result.current.status).not.toBe(CONNECTION_STATUS.RECONNECTING);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useFileTransfer — reconnect / resume integration
// ═══════════════════════════════════════════════════════════════════════════════

describe('useFileTransfer reconnect / resume', () => {
  let mockDc;

  beforeEach(async () => {
    mockDc = makeMockDc();
    const { openSink } = await import('../hooks/receiverSink.js');
    openSink.mockClear();
  });

  function makeMockFile(sizeBytes = 1024 * 1024) {
    const data = new Uint8Array(sizeBytes).fill(0x42);
    return new File([data], 'big.bin', { type: 'application/octet-stream' });
  }

  // ── 8. Channel interrupt preserves transfer state (INTERRUPTED, not removed) ──

  it('preserves transfer in INTERRUPTED state (not removed) on channel close', async () => {
    const { result } = renderHook(() => useFileTransfer(mockDc));

    await act(async () => {
      mockDc._emit('message',
        makeTransferMsg(TRANSFER_MSG.FILE_META, {
          transferId: 'rx-1', name: 'f.bin', size: 500, mimeType: 'application/octet-stream',
        }),
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    await act(async () => {
      mockDc._emit('close', {});
      await new Promise((r) => setTimeout(r, 10));
    });

    // Transfer must still exist in the list.
    expect(result.current.transfers).toHaveLength(1);
    expect(result.current.transfers[0].status).toBe(TRANSFER_STATUS.INTERRUPTED);
  });

  // ── 9. New channel → receiver sends RESUME_REQUEST ────────────────────────────

  it('receiver sends RESUME_REQUEST on new channel after interrupt', async () => {
    const { result } = renderHook(() => useFileTransfer(mockDc));

    // Receive some chunks.
    await act(async () => {
      mockDc._emit('message',
        makeTransferMsg(TRANSFER_MSG.FILE_META, {
          transferId: 'rx-2', name: 'f.bin', size: 1000, mimeType: 'application/octet-stream',
        }),
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    // Receive 200 bytes.
    const chunk = new Uint8Array(200).fill(0x01).buffer;
    await act(async () => {
      mockDc._emit('message', { data: chunk });
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.transfers[0].bytesTransferred).toBe(200);

    // Simulate interrupt.
    await act(async () => {
      mockDc._emit('close', {});
      await new Promise((r) => setTimeout(r, 10));
    });

    // Now provide a new open channel (reconnect).
    const newDc = makeMockDc('open');
    await act(async () => {
      result.current; // force re-render with new channel
    });

    // Re-render the hook with the new channel.
    const { result: _result2 } = renderHook(() => useFileTransfer(newDc));

    // The new hook instance won't have the old receiveStateRef — that's expected.
    // For a real integration, both channels are passed to the same hook instance.
    // Let's test the single-instance path instead.
    const { rerender, result: r } = renderHook(
      ({ dc }) => useFileTransfer(dc),
      { initialProps: { dc: mockDc } },
    );

    // Fresh meta on this hook instance.
    await act(async () => {
      mockDc._emit('message',
        makeTransferMsg(TRANSFER_MSG.FILE_META, {
          transferId: 'rx-3', name: 'g.bin', size: 1000, mimeType: 'application/octet-stream',
        }),
      );
      await new Promise((r2) => setTimeout(r2, 20));
    });

    const chunk2 = new Uint8Array(300).fill(0x02).buffer;
    await act(async () => {
      mockDc._emit('message', { data: chunk2 });
      await new Promise((r2) => setTimeout(r2, 10));
    });

    // Channel interrupt.
    await act(async () => {
      mockDc._emit('close', {});
      await new Promise((r2) => setTimeout(r2, 10));
    });

    expect(r.current.transfers[0].status).toBe(TRANSFER_STATUS.INTERRUPTED);
    expect(r.current.transfers[0].bytesTransferred).toBe(300);

    // Now rerender with a new open channel.
    const newDc2 = makeMockDc('open');
    await act(async () => {
      rerender({ dc: newDc2 });
      await new Promise((r2) => setTimeout(r2, 10));
    });

    // Should have sent RESUME_REQUEST with offset = 300.
    const resumeMsg = newDc2.send.mock.calls
      .map((c) => { try { return JSON.parse(c[0]); } catch { return null; } })
      .find((m) => m?.type === TRANSFER_MSG.RESUME_REQUEST);

    expect(resumeMsg).toBeDefined();
    expect(resumeMsg.payload.offset).toBe(300);
  });

  // ── 10. Sender handles RESUME_REQUEST → sends RESUME_ACK ─────────────────────

  it('sender responds to RESUME_REQUEST with RESUME_ACK and resumes from offset', async () => {
    const { rerender, result: r } = renderHook(
      ({ dc }) => useFileTransfer(dc),
      { initialProps: { dc: mockDc } },
    );

    const file = makeMockFile(500 * 1024);

    // Start the send, then immediately close the channel so the loop is
    // interrupted on its first readyState check (deterministic in jsdom).
    let transferId;
    act(() => {
      transferId = r.current.sendFile(file);
      mockDc.readyState = 'closed';
    });

    await act(async () => {
      mockDc._emit('close', {});
      await new Promise((r2) => setTimeout(r2, 20));
    });

    const pausedTransfer = r.current.transfers.find((t) => t.id === transferId);
    expect(pausedTransfer?.status).toBe(TRANSFER_STATUS.INTERRUPTED);

    const pausedOffset = pausedTransfer?.bytesTransferred ?? 0;

    // Reconnect with a new channel.
    const newDc = makeMockDc('open');
    await act(async () => {
      rerender({ dc: newDc });
      await new Promise((r2) => setTimeout(r2, 10));
    });

    // Simulate receiver sending RESUME_REQUEST at the paused offset.
    const resumeRequest = makeTransferMsg(TRANSFER_MSG.RESUME_REQUEST, {
      transferId,
      offset: pausedOffset,
    });

    await act(async () => {
      newDc._emit('message', resumeRequest);
      await new Promise((r2) => setTimeout(r2, 20));
    });

    // Should have sent RESUME_ACK.
    const ackCalls = newDc.send.mock.calls
      .map((c) => { try { return JSON.parse(c[0]); } catch { return null; } })
      .filter((m) => m?.type === TRANSFER_MSG.RESUME_ACK);

    expect(ackCalls.length).toBeGreaterThan(0);
    expect(ackCalls[0].payload.offset).toBe(pausedOffset);
  });

  // ── 11. onReconnectFailed → partial state discarded, final INTERRUPTED ─────────

  it('discards partial transfer state and sets final error when reconnect fails', async () => {
    const onReconnectFailedRef = { current: null };
    const { result } = renderHook(() =>
      useFileTransfer(mockDc, onReconnectFailedRef),
    );

    // Start a receive.
    await act(async () => {
      mockDc._emit('message',
        makeTransferMsg(TRANSFER_MSG.FILE_META, {
          transferId: 'rx-fail', name: 'f.bin', size: 5000, mimeType: 'application/octet-stream',
        }),
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(result.current.transfers[0].status).toBe(TRANSFER_STATUS.TRANSFERRING);

    // Interrupt.
    await act(async () => {
      mockDc._emit('close', {});
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.transfers[0].status).toBe(TRANSFER_STATUS.INTERRUPTED);

    // Simulate usePeerConnection calling the reconnect-failed callback.
    await act(async () => {
      onReconnectFailedRef.current?.();
      await new Promise((r) => setTimeout(r, 10));
    });

    const t = result.current.transfers[0];
    // Still INTERRUPTED but with a "could not be re-established" message.
    expect(t.status).toBe(TRANSFER_STATUS.INTERRUPTED);
    expect(t.error).toMatch(/could not be re-established/i);
  });

  // ── 12. RESUMING status set while awaiting resume handshake ───────────────────

  it('receiver transitions to RESUMING when new channel arrives with in-flight transfer', async () => {
    const { rerender, result } = renderHook(
      ({ dc }) => useFileTransfer(dc),
      { initialProps: { dc: mockDc } },
    );

    // Start receive.
    await act(async () => {
      mockDc._emit('message',
        makeTransferMsg(TRANSFER_MSG.FILE_META, {
          transferId: 'rx-resuming', name: 'h.bin', size: 2000, mimeType: 'application/octet-stream',
        }),
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    // Receive some bytes.
    const chunk = new Uint8Array(100).fill(0x01).buffer;
    await act(async () => {
      mockDc._emit('message', { data: chunk });
      await new Promise((r) => setTimeout(r, 10));
    });

    // Interrupt.
    await act(async () => {
      mockDc._emit('close', {});
      await new Promise((r) => setTimeout(r, 10));
    });

    // New channel.
    const newDc = makeMockDc('open');
    await act(async () => {
      rerender({ dc: newDc });
      await new Promise((r) => setTimeout(r, 10));
    });

    // After connecting to new channel with in-flight receive, status should be RESUMING.
    expect(result.current.transfers[0].status).toBe(TRANSFER_STATUS.RESUMING);
  });
});
