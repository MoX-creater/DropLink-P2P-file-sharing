/**
 * Room manager tests.
 *
 * roomManager keeps state in module-level Maps, so we reload the module before
 * each test to get a clean slate.  vi.resetModules() + dynamic import achieves
 * this without touching the file system.
 *
 * Mock WebSocket objects only need: readyState, OPEN, and send().
 * We use vi.fn() for send so we can inspect what was transmitted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock WebSocket factory ───────────────────────────────────────────────────

function makeMockWs() {
  const ws = {
    readyState: 1, // 1 = OPEN (mirrors ws.WebSocket.OPEN)
    OPEN: 1,
    send: vi.fn(),
    _remoteIp: '127.0.0.1',
  };
  return ws;
}

// ─── Module reload helper ─────────────────────────────────────────────────────

async function freshRoomManager() {
  vi.resetModules();
  return import('../roomManager.js');
}

// ─── isValidRoomId ────────────────────────────────────────────────────────────

describe('isValidRoomId', () => {
  let isValidRoomId;

  beforeEach(async () => {
    ({ isValidRoomId } = await freshRoomManager());
  });

  it('accepts alphanumeric ids', () => {
    expect(isValidRoomId('abcd1234')).toBe(true);
  });

  it('accepts ids with hyphens', () => {
    expect(isValidRoomId('room-abc-123')).toBe(true);
  });

  it('accepts exactly 4 characters', () => {
    expect(isValidRoomId('abcd')).toBe(true);
  });

  it('accepts exactly 64 characters', () => {
    expect(isValidRoomId('a'.repeat(64))).toBe(true);
  });

  it('rejects 3-character ids (too short)', () => {
    expect(isValidRoomId('abc')).toBe(false);
  });

  it('rejects 65-character ids (too long)', () => {
    expect(isValidRoomId('a'.repeat(65))).toBe(false);
  });

  it('rejects ids with spaces', () => {
    expect(isValidRoomId('room abc')).toBe(false);
  });

  it('rejects ids with special characters', () => {
    expect(isValidRoomId('room@123')).toBe(false);
    expect(isValidRoomId('room/123')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isValidRoomId(null)).toBe(false);
    expect(isValidRoomId(undefined)).toBe(false);
    expect(isValidRoomId(1234)).toBe(false);
  });
});

// ─── joinRoom ─────────────────────────────────────────────────────────────────

describe('joinRoom', () => {
  let joinRoom, getMetrics;

  beforeEach(async () => {
    ({ joinRoom, getMetrics } = await freshRoomManager());
  });

  it('first peer joins successfully and is the initiator', () => {
    const ws = makeMockWs();
    const result = joinRoom(ws, 'test-room');

    expect(result.success).toBe(true);
    expect(result.isInitiator).toBe(true);
    expect(typeof result.peerId).toBe('string');
    expect(result.peerId.length).toBeGreaterThan(0);
  });

  it('second peer joins successfully and is not the initiator', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    joinRoom(ws1, 'test-room');
    const result = joinRoom(ws2, 'test-room');

    expect(result.success).toBe(true);
    expect(result.isInitiator).toBe(false);
  });

  it("second peer receives the first peer's id as existingPeerId", () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    const first = joinRoom(ws1, 'test-room');
    const second = joinRoom(ws2, 'test-room');

    expect(second.existingPeerId).toBe(first.peerId);
  });

  it('first peer is notified via peer-joined when second peer joins', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    joinRoom(ws1, 'test-room');
    joinRoom(ws2, 'test-room');

    expect(ws1.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws1.send.mock.calls[0][0]);
    expect(sent.type).toBe('peer-joined');
  });

  it('rejects a third peer with reason "room-full"', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();
    const ws3 = makeMockWs();

    joinRoom(ws1, 'test-room');
    joinRoom(ws2, 'test-room');
    const result = joinRoom(ws3, 'test-room');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('room-full');
  });

  it('rejects an invalid roomId', () => {
    const ws = makeMockWs();
    const result = joinRoom(ws, 'x!'); // too short + invalid char

    expect(result.success).toBe(false);
    expect(result.reason).toBe('invalid-room-id');
  });

  it('assigns distinct peerIds to each peer', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    const r1 = joinRoom(ws1, 'test-room');
    const r2 = joinRoom(ws2, 'test-room');

    expect(r1.peerId).not.toBe(r2.peerId);
  });

  it('getMetrics reflects joined peers', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    joinRoom(ws1, 'room-a');
    joinRoom(ws2, 'room-a');

    const { roomCount, peerCount } = getMetrics();
    expect(roomCount).toBe(1);
    expect(peerCount).toBe(2);
  });
});

// ─── removePeer / disconnect cleanup ─────────────────────────────────────────

describe('removePeer', () => {
  let joinRoom, removePeer, getMetrics;

  beforeEach(async () => {
    ({ joinRoom, removePeer, getMetrics } = await freshRoomManager());
  });

  it('removes the only peer and deletes the room', () => {
    const ws = makeMockWs();
    joinRoom(ws, 'solo-room');
    removePeer(ws);

    const { roomCount, peerCount } = getMetrics();
    expect(roomCount).toBe(0);
    expect(peerCount).toBe(0);
  });

  it('notifies the remaining peer with peer-left when one peer disconnects', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    joinRoom(ws1, 'two-peer-room');
    joinRoom(ws2, 'two-peer-room');

    // Clear the peer-joined notification so we can inspect only peer-left.
    ws1.send.mockClear();

    removePeer(ws2);

    expect(ws1.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws1.send.mock.calls[0][0]);
    expect(sent.type).toBe('peer-left');
    expect(sent.payload.reason).toBe('peer-disconnected');
  });

  it('removes the room from metrics after both peers disconnect', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    joinRoom(ws1, 'cleanup-room');
    joinRoom(ws2, 'cleanup-room');

    removePeer(ws1);
    removePeer(ws2);

    const { roomCount, peerCount } = getMetrics();
    expect(roomCount).toBe(0);
    expect(peerCount).toBe(0);
  });

  it('is a no-op when called for a ws that never joined', () => {
    const ws = makeMockWs();
    // Should not throw.
    expect(() => removePeer(ws)).not.toThrow();
  });

  it('does not send peer-left to the disconnecting peer itself', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    joinRoom(ws1, 'room-xy');
    joinRoom(ws2, 'room-xy');

    ws2.send.mockClear();
    removePeer(ws2);

    // ws2 disconnected — it must not receive peer-left.
    expect(ws2.send).not.toHaveBeenCalled();
  });
});

// ─── TTL expiry ───────────────────────────────────────────────────────────────

describe('room TTL', () => {
  let joinRoom, getMetrics;

  beforeEach(async () => {
    // Set a very short TTL for testing.
    process.env.ROOM_TTL_MS = '50';
    vi.useFakeTimers();
    ({ joinRoom, getMetrics } = await freshRoomManager());
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ROOM_TTL_MS;
  });

  it('expires a single-peer room after ROOM_TTL_MS', async () => {
    const ws = makeMockWs();
    joinRoom(ws, 'ttl-room');

    expect(getMetrics().roomCount).toBe(1);

    // Advance past the TTL.
    vi.advanceTimersByTime(100);

    expect(getMetrics().roomCount).toBe(0);
  });

  it('sends peer-left with reason "room-expired" on TTL cleanup', () => {
    const ws = makeMockWs();
    joinRoom(ws, 'ttl-room');
    ws.send.mockClear();

    vi.advanceTimersByTime(100);

    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent.type).toBe('peer-left');
    expect(sent.payload.reason).toBe('room-expired');
  });

  it('cancels the TTL when a second peer joins', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    joinRoom(ws1, 'ttl-room');
    joinRoom(ws2, 'ttl-room'); // should cancel the TTL

    vi.advanceTimersByTime(100);

    // Both peers still present — room was not expired.
    expect(getMetrics().roomCount).toBe(1);
    expect(getMetrics().peerCount).toBe(2);
  });
});

// ─── relayMessage ─────────────────────────────────────────────────────────────

describe('relayMessage', () => {
  let joinRoom, relayMessage, getPeerMeta;

  beforeEach(async () => {
    ({ joinRoom, relayMessage, getPeerMeta } = await freshRoomManager());
  });

  it('relays an offer from peer1 to peer2', () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();

    const r1 = joinRoom(ws1, 'relay-room');
    const r2 = joinRoom(ws2, 'relay-room');

    ws2.send.mockClear();

    const result = relayMessage(ws1, {
      type: 'offer',
      payload: { sdp: 'v=0' },
      to: r2.peerId,
    });

    expect(result.relayed).toBe(true);
    expect(ws2.send).toHaveBeenCalledOnce();

    const forwarded = JSON.parse(ws2.send.mock.calls[0][0]);
    expect(forwarded.type).toBe('offer');
    expect(forwarded.from).toBe(r1.peerId);
    // Server must NOT expose SDP contents in its own log/return value.
    // The forwarded payload should be passed through unchanged.
    expect(forwarded.payload.sdp).toBe('v=0');
  });

  it('returns relayed:false when the "to" peer is not in the room', () => {
    const ws1 = makeMockWs();
    joinRoom(ws1, 'relay-room');

    const result = relayMessage(ws1, {
      type: 'offer',
      payload: {},
      to: 'nonexistent-peer-id',
    });

    expect(result.relayed).toBe(false);
    expect(result.reason).toMatch(/not found/);
  });

  it('returns relayed:false when the sender has not joined a room', () => {
    const ws = makeMockWs();

    const result = relayMessage(ws, {
      type: 'offer',
      payload: {},
      to: 'some-peer',
    });

    expect(result.relayed).toBe(false);
  });
});
