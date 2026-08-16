/**
 * usePeerConnection state machine tests.
 *
 * Strategy:
 *   - Mock WebSocket and RTCPeerConnection at the global level.
 *   - Use renderHook from @testing-library/react.
 *   - Simulate server messages by calling the captured ws.onmessage handler.
 *   - Assert that each server/ICE event drives the correct state transition.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePeerConnection, CONNECTION_STATUS } from '../hooks/usePeerConnection.js';
import { MSG_TYPES, makeEnvelope } from '../hooks/protocol.js';

// ─── WebSocket mock factory ───────────────────────────────────────────────────

function makeMockWs() {
  const ws = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  };
  return ws;
}

// ─── RTCPeerConnection mock factory ──────────────────────────────────────────

function makeMockPc() {
  const dc = {
    readyState: 'connecting',
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onclose: null,
    onerror: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  const pc = {
    _dc: dc,
    createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-offer-sdp' }),
    createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-answer-sdp' }),
    setLocalDescription: vi.fn().mockResolvedValue(undefined),
    setRemoteDescription: vi.fn().mockResolvedValue(undefined),
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
    createDataChannel: vi.fn().mockReturnValue(dc),
    restartIce: vi.fn(),
    close: vi.fn(),
    localDescription: { type: 'offer', sdp: 'mock-local-sdp' },
    iceConnectionState: 'new',
    onicecandidate: null,
    oniceconnectionstatechange: null,
    ondatachannel: null,
  };
  return pc;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fire a simulated server→client message on a captured ws instance. */
function serverSend(ws, type, payload, extra = {}) {
  const raw = JSON.stringify({ type, payload, ...extra });
  act(() => {
    ws.onmessage?.({ data: raw });
  });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('usePeerConnection', () => {
  let mockWs;
  let mockPc;
  let WsConstructorSpy;
  let PcConstructorSpy;

  beforeEach(() => {
    mockWs = makeMockWs();
    mockPc = makeMockPc();

    // Vitest 4: use mockImplementation with a class. Returning an object from
    // a constructor makes `new Foo()` evaluate to that object, giving us a
    // single shared reference the hook and tests both see.
    WsConstructorSpy = vi.fn().mockImplementation(class {
      // eslint-disable-next-line no-constructor-return
      constructor() { return mockWs; }
    });
    WsConstructorSpy.CONNECTING = 0;
    WsConstructorSpy.OPEN = 1;
    WsConstructorSpy.CLOSING = 2;
    WsConstructorSpy.CLOSED = 3;
    global.WebSocket = WsConstructorSpy;

    PcConstructorSpy = vi.fn().mockImplementation(class {
      // eslint-disable-next-line no-constructor-return
      constructor() { return mockPc; }
    });
    global.RTCPeerConnection = PcConstructorSpy;
    global.RTCSessionDescription = vi.fn().mockImplementation(class {
      constructor(init) { Object.assign(this, init); }
    });
    global.RTCIceCandidate = vi.fn().mockImplementation(class {
      constructor(init) { Object.assign(this, init); }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Initial state ───────────────────────────────────────────────────────────

  it('starts in idle state', () => {
    const { result } = renderHook(() => usePeerConnection());
    expect(result.current.status).toBe(CONNECTION_STATUS.IDLE);
    expect(result.current.roomId).toBeNull();
    expect(result.current.peerId).toBeNull();
    expect(result.current.dataChannel).toBeNull();
    expect(result.current.error).toBeNull();
  });

  // ── createRoom → connecting ─────────────────────────────────────────────────

  it('transitions to connecting when createRoom is called', () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.createRoom(); });

    expect(result.current.status).toBe(CONNECTION_STATUS.CONNECTING);
    expect(WsConstructorSpy).toHaveBeenCalledOnce();
    expect(PcConstructorSpy).toHaveBeenCalledOnce();
  });

  // ── room-joined (initiator) → waiting-for-peer ──────────────────────────────

  it('transitions to waiting-for-peer after room-joined as initiator', () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.createRoom(); });
    act(() => { mockWs.onopen?.(); });

    serverSend(mockWs, MSG_TYPES.ROOM_JOINED, {
      roomId: 'ABCD12',
      peerId: 'peer-uuid-1',
      isInitiator: true,
    });

    expect(result.current.status).toBe(CONNECTION_STATUS.WAITING_FOR_PEER);
    expect(result.current.roomId).toBe('ABCD12');
    expect(result.current.peerId).toBe('peer-uuid-1');
  });

  // ── room-joined (joiner) → negotiating ─────────────────────────────────────

  it('transitions to negotiating after room-joined as joiner', () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.joinRoom('ABCD12'); });
    act(() => { mockWs.onopen?.(); });

    serverSend(mockWs, MSG_TYPES.ROOM_JOINED, {
      roomId: 'ABCD12',
      peerId: 'peer-uuid-2',
      isInitiator: false,
      existingPeerId: 'peer-uuid-1',
    });

    expect(result.current.status).toBe(CONNECTION_STATUS.NEGOTIATING);
  });

  // ── peer-joined → offer sent ────────────────────────────────────────────────

  it('sends an offer when peer-joined is received as initiator', async () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.createRoom(); });
    act(() => { mockWs.onopen?.(); });

    serverSend(mockWs, MSG_TYPES.ROOM_JOINED, {
      roomId: 'ABCD12', peerId: 'peer-uuid-1', isInitiator: true,
    });

    await act(async () => {
      serverSend(mockWs, MSG_TYPES.PEER_JOINED, { peerId: 'peer-uuid-2' });
      // Let the async offer creation resolve.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should have sent join-room on open, then an offer.
    const sentMessages = mockWs.send.mock.calls.map((c) => JSON.parse(c[0]));
    const offerMsg = sentMessages.find((m) => m.type === MSG_TYPES.OFFER);
    expect(offerMsg).toBeDefined();
    expect(offerMsg.to).toBe('peer-uuid-2');
  });

  // ── data channel open → connected ──────────────────────────────────────────

  it('transitions to connected when data channel opens', async () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.createRoom(); });
    act(() => { mockWs.onopen?.(); });

    serverSend(mockWs, MSG_TYPES.ROOM_JOINED, {
      roomId: 'ABCD12', peerId: 'peer-uuid-1', isInitiator: true,
    });

    await act(async () => {
      serverSend(mockWs, MSG_TYPES.PEER_JOINED, { peerId: 'peer-uuid-2' });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Simulate data channel opening.
    act(() => { mockPc._dc.onopen?.(); });

    expect(result.current.status).toBe(CONNECTION_STATUS.CONNECTED);
    expect(result.current.dataChannel).not.toBeNull();
  });

  // ── room-full → distinct state ─────────────────────────────────────────────

  it('transitions to room-full on room-full message — distinct from invalid-room', () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.joinRoom('ABCD12'); });
    act(() => { mockWs.onopen?.(); });

    serverSend(mockWs, MSG_TYPES.ROOM_FULL, { roomId: 'ABCD12' });

    expect(result.current.status).toBe(CONNECTION_STATUS.ROOM_FULL);
    expect(result.current.status).not.toBe(CONNECTION_STATUS.INVALID_ROOM);
    expect(result.current.status).not.toBe(CONNECTION_STATUS.SIGNALING_ERROR);
  });

  // ── invalid roomId error → distinct state ──────────────────────────────────

  it('transitions to invalid-room on server error about invalid roomId', () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.joinRoom('ABCD12'); });
    act(() => { mockWs.onopen?.(); });

    serverSend(mockWs, MSG_TYPES.ERROR, {
      message: 'invalid roomId "X!" — use 4–64 alphanumeric characters or hyphens',
    });

    expect(result.current.status).toBe(CONNECTION_STATUS.INVALID_ROOM);
    expect(result.current.status).not.toBe(CONNECTION_STATUS.ROOM_FULL);
    expect(result.current.status).not.toBe(CONNECTION_STATUS.SIGNALING_ERROR);
  });

  // ── generic server error → signaling-error ─────────────────────────────────

  it('transitions to signaling-error on a generic server error envelope', () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.joinRoom('ABCD12'); });
    act(() => { mockWs.onopen?.(); });

    serverSend(mockWs, MSG_TYPES.ERROR, { message: 'too many join attempts — please wait' });

    expect(result.current.status).toBe(CONNECTION_STATUS.SIGNALING_ERROR);
    expect(result.current.error).toMatch(/too many join attempts/);
  });

  // ── peer-left → peer-disconnected ──────────────────────────────────────────

  it('transitions to peer-disconnected on peer-left', () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.createRoom(); });
    act(() => { mockWs.onopen?.(); });

    serverSend(mockWs, MSG_TYPES.PEER_LEFT, { reason: 'peer-disconnected' });

    expect(result.current.status).toBe(CONNECTION_STATUS.PEER_DISCONNECTED);
  });

  // ── peer-left (room-expired) ────────────────────────────────────────────────

  it('surfaces room-expired reason in error field on TTL peer-left', () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.createRoom(); });
    act(() => { mockWs.onopen?.(); });

    serverSend(mockWs, MSG_TYPES.PEER_LEFT, { reason: 'room-expired' });

    expect(result.current.status).toBe(CONNECTION_STATUS.PEER_DISCONNECTED);
    expect(result.current.error).toMatch(/room expired/);
  });

  // ── cleanup() idempotency ───────────────────────────────────────────────────

  it('cleanup() is idempotent — safe to call multiple times', () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.createRoom(); });
    act(() => { mockWs.onopen?.(); });

    // Call cleanup three times — should not throw.
    expect(() => {
      act(() => { result.current.cleanup(); });
      act(() => { result.current.cleanup(); });
      act(() => { result.current.cleanup(); });
    }).not.toThrow();

    expect(result.current.status).toBe(CONNECTION_STATUS.IDLE);
    expect(result.current.roomId).toBeNull();
    expect(result.current.peerId).toBeNull();
    expect(result.current.dataChannel).toBeNull();
  });

  // ── cleanup() resets to idle ────────────────────────────────────────────────

  it('cleanup() resets all state to idle', () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.createRoom(); });
    act(() => { mockWs.onopen?.(); });

    serverSend(mockWs, MSG_TYPES.ROOM_JOINED, {
      roomId: 'ABCD12', peerId: 'peer-uuid-1', isInitiator: true,
    });

    expect(result.current.status).toBe(CONNECTION_STATUS.WAITING_FOR_PEER);

    act(() => { result.current.cleanup(); });

    expect(result.current.status).toBe(CONNECTION_STATUS.IDLE);
    expect(result.current.roomId).toBeNull();
    expect(result.current.peerId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  // ── cleanup() allows re-use ─────────────────────────────────────────────────

  it('can createRoom again after cleanup()', () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.createRoom(); });
    act(() => { result.current.cleanup(); });

    expect(result.current.status).toBe(CONNECTION_STATUS.IDLE);

    act(() => { result.current.createRoom(); });

    expect(result.current.status).toBe(CONNECTION_STATUS.CONNECTING);
  });

  // ── WebSocket error → signaling-error ──────────────────────────────────────

  it('transitions to signaling-error on WebSocket error event', () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.createRoom(); });

    act(() => { mockWs.onerror?.(); });

    expect(result.current.status).toBe(CONNECTION_STATUS.SIGNALING_ERROR);
  });

  // ── join-room message is sent on WS open ───────────────────────────────────

  it('sends join-room with the correct roomId when WS opens', () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.joinRoom('TESTROOM'); });
    act(() => { mockWs.onopen?.(); });

    expect(mockWs.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sent.type).toBe(MSG_TYPES.JOIN_ROOM);
    expect(sent.payload.roomId).toBe('TESTROOM');
  });

  // ── ICE candidate relayed to correct peer ──────────────────────────────────

  it('sends ice-candidate to the remote peer with correct "to" field', async () => {
    const { result } = renderHook(() => usePeerConnection());

    act(() => { result.current.createRoom(); });
    act(() => { mockWs.onopen?.(); });

    serverSend(mockWs, MSG_TYPES.ROOM_JOINED, {
      roomId: 'ABCD12', peerId: 'peer-uuid-1', isInitiator: true,
    });

    await act(async () => {
      serverSend(mockWs, MSG_TYPES.PEER_JOINED, { peerId: 'peer-uuid-2' });
      await Promise.resolve();
      await Promise.resolve();
    });

    mockWs.send.mockClear();

    // Simulate an ICE candidate being gathered.
    act(() => {
      mockPc.onicecandidate?.({
        candidate: { toJSON: () => ({ candidate: 'ice-candidate-data' }) },
      });
    });

    const sentMessages = mockWs.send.mock.calls.map((c) => JSON.parse(c[0]));
    const iceMsg = sentMessages.find((m) => m.type === MSG_TYPES.ICE_CANDIDATE);
    expect(iceMsg).toBeDefined();
    expect(iceMsg.to).toBe('peer-uuid-2');
  });

  // ── unmount teardown ────────────────────────────────────────────────────────

  it('closes WS and PC on unmount', () => {
    const { result, unmount } = renderHook(() => usePeerConnection());

    act(() => { result.current.createRoom(); });

    unmount();

    expect(mockWs.close).toHaveBeenCalled();
    expect(mockPc.close).toHaveBeenCalled();
  });
});
