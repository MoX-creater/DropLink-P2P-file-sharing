import { describe, it, expect } from 'vitest';
import {
  validateEnvelope,
  makeErrorEnvelope,
  makeEnvelope,
  MSG_TYPES,
} from '../protocol.js';

// ─── validateEnvelope ─────────────────────────────────────────────────────────

describe('validateEnvelope', () => {
  describe('structural rejections', () => {
    it('rejects null', () => {
      const r = validateEnvelope(null);
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/JSON object/);
    });

    it('rejects an array', () => {
      const r = validateEnvelope([]);
      expect(r.valid).toBe(false);
    });

    it('rejects a plain string', () => {
      const r = validateEnvelope('hello');
      expect(r.valid).toBe(false);
    });

    it('rejects a number', () => {
      expect(validateEnvelope(42).valid).toBe(false);
    });
  });

  describe('missing / bad "type"', () => {
    it('rejects a message with no type field', () => {
      const r = validateEnvelope({ payload: {} });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/type/);
    });

    it('rejects an empty-string type', () => {
      const r = validateEnvelope({ type: '', payload: {} });
      expect(r.valid).toBe(false);
    });

    it('rejects an unknown type string', () => {
      const r = validateEnvelope({ type: 'completely-unknown', payload: {} });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/unknown message type/);
    });

    it('rejects a numeric type', () => {
      const r = validateEnvelope({ type: 42, payload: {} });
      expect(r.valid).toBe(false);
    });
  });

  describe('missing payload', () => {
    it('rejects a message without a payload field', () => {
      const r = validateEnvelope({ type: MSG_TYPES.JOIN_ROOM });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/payload/);
    });
  });

  describe('routed messages — missing "to"', () => {
    it('rejects an offer without a "to" field', () => {
      const r = validateEnvelope({ type: MSG_TYPES.OFFER, payload: { sdp: 'x' } });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/"to"/);
    });

    it('rejects an answer without a "to" field', () => {
      const r = validateEnvelope({ type: MSG_TYPES.ANSWER, payload: {} });
      expect(r.valid).toBe(false);
    });

    it('rejects ice-candidate without a "to" field', () => {
      const r = validateEnvelope({ type: MSG_TYPES.ICE_CANDIDATE, payload: {} });
      expect(r.valid).toBe(false);
    });

    it('rejects an empty-string "to" on a routed message', () => {
      const r = validateEnvelope({ type: MSG_TYPES.OFFER, payload: {}, to: '' });
      expect(r.valid).toBe(false);
    });
  });

  describe('valid envelopes', () => {
    it('accepts a well-formed join-room', () => {
      const r = validateEnvelope({
        type: MSG_TYPES.JOIN_ROOM,
        payload: { roomId: 'room-abc' },
      });
      expect(r.valid).toBe(true);
    });

    it('accepts a well-formed offer with "to"', () => {
      const r = validateEnvelope({
        type: MSG_TYPES.OFFER,
        payload: { sdp: 'v=0...' },
        to: 'peer-uuid-123',
      });
      expect(r.valid).toBe(true);
    });

    it('accepts a well-formed answer with "to"', () => {
      const r = validateEnvelope({
        type: MSG_TYPES.ANSWER,
        payload: { sdp: 'v=0...' },
        to: 'peer-uuid-456',
      });
      expect(r.valid).toBe(true);
    });

    it('accepts ice-candidate with "to"', () => {
      const r = validateEnvelope({
        type: MSG_TYPES.ICE_CANDIDATE,
        payload: { candidate: '...' },
        to: 'peer-uuid-789',
      });
      expect(r.valid).toBe(true);
    });

    it('accepts a server→client type (room-joined) without "to"', () => {
      // Server-originating types are valid envelope types even if the server
      // would reject a client sending them; validateEnvelope only checks shape.
      const r = validateEnvelope({
        type: MSG_TYPES.ROOM_JOINED,
        payload: { roomId: 'r', peerId: 'p', isInitiator: true },
      });
      expect(r.valid).toBe(true);
    });
  });
});

// ─── makeErrorEnvelope / makeEnvelope ─────────────────────────────────────────

describe('makeErrorEnvelope', () => {
  it('returns valid JSON with type=error', () => {
    const raw = makeErrorEnvelope('something went wrong');
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe(MSG_TYPES.ERROR);
    expect(parsed.payload.message).toBe('something went wrong');
  });
});

describe('makeEnvelope', () => {
  it('omits "to" when not supplied', () => {
    const raw = makeEnvelope(MSG_TYPES.PEER_LEFT, { reason: 'disconnected' });
    const parsed = JSON.parse(raw);
    expect(parsed.to).toBeUndefined();
    expect(parsed.type).toBe(MSG_TYPES.PEER_LEFT);
  });

  it('includes "to" when supplied', () => {
    const raw = makeEnvelope(MSG_TYPES.OFFER, { sdp: 'x' }, 'peer-123');
    const parsed = JSON.parse(raw);
    expect(parsed.to).toBe('peer-123');
  });
});
