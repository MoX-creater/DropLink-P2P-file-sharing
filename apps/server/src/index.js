import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import { logger } from './logger.js';
import {
  MSG_TYPES,
  ROUTED_TYPES,
  validateEnvelope,
  makeErrorEnvelope,
  makeEnvelope,
} from './protocol.js';
import {
  joinRoom,
  removePeer,
  relayMessage,
  getPeerMeta,
  getMetrics,
} from './roomManager.js';
import {
  checkRateLimit,
  startRateLimitSweep,
} from './rateLimiter.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === 'production';

// 1. PORT: read process.env.PORT || 3001
const rawPort = process.env.PORT;
const isPortFromEnv = Boolean(rawPort);
const PORT = parseInt(rawPort, 10) || 3001;

// 2. CLIENT_ORIGIN: read process.env.CLIENT_ORIGIN with dev fallback only
let clientOrigin = process.env.CLIENT_ORIGIN;
if (!clientOrigin) {
  if (IS_PROD) {
    logger.error('startup-config-error', { error: 'CLIENT_ORIGIN environment variable is required in production' });
    throw new Error('FATAL: CLIENT_ORIGIN environment variable is required in production');
  }
  clientOrigin = 'http://localhost:5173';
}

// 3. ALLOWED_ORIGINS: read process.env.ALLOWED_ORIGINS with dev fallback only
let allowedOriginsRaw = process.env.ALLOWED_ORIGINS;
if (!allowedOriginsRaw) {
  if (IS_PROD) {
    logger.error('startup-config-error', { error: 'ALLOWED_ORIGINS environment variable is required in production' });
    throw new Error('FATAL: ALLOWED_ORIGINS environment variable is required in production');
  }
  allowedOriginsRaw = 'http://localhost:5173';
}

const ALLOWED_ORIGINS = new Set(
  allowedOriginsRaw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
);

const START_TIME = Date.now();

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();

app.use(
  cors({
    origin: clientOrigin,
  }),
);

app.get('/', (_req, res) => {
  res.json({
    service: 'DropLink Signaling Server',
    status: 'running',
    health: '/health',
    clientUrl: clientOrigin,
  });
});

app.get('/health', (_req, res) => {
  const { roomCount, peerCount } = getMetrics();
  res.json({
    status: 'ok',
    uptimeMs: Date.now() - START_TIME,
    rooms: roomCount,
    peers: peerCount,
  });
});

// ─── HTTP + WS server ─────────────────────────────────────────────────────────

const server = createServer(app);

// noServer: true — we manage the upgrade ourselves so we can reject on origin.
const wss = new WebSocketServer({ noServer: true });

// ─── Origin-gated upgrade handler ────────────────────────────────────────────
// The `cors` middleware only covers Express HTTP routes; WebSocket upgrade
// requests bypass it entirely.  We must check the origin here.

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin ?? '';

  if (!ALLOWED_ORIGINS.has(origin)) {
    logger.warn('ws-upgrade-rejected', { origin });
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    // Attach the real IP to the socket for rate-limiting.
    // X-Forwarded-For is trusted only if you sit behind a known proxy; for now
    // we fall back to the direct connection address.
    ws._remoteIp =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ??
      req.socket.remoteAddress ??
      'unknown';

    wss.emit('connection', ws, req);
  });
});

// ─── WebSocket message handler ────────────────────────────────────────────────

wss.on('connection', (ws) => {
  logger.info('ws-connected', { ip: ws._remoteIp });

  ws.on('message', (raw) => {
    handleMessage(ws, raw);
  });

  ws.on('close', () => {
    const meta = getPeerMeta(ws);
    logger.info('ws-disconnected', {
      ip: ws._remoteIp,
      roomId: meta?.roomId ?? null,
      peerId: meta?.peerId ?? null,
    });
    removePeer(ws);
  });

  ws.on('error', (err) => {
    logger.error('ws-error', { ip: ws._remoteIp, message: err.message });
  });
});

// ─── Message routing ──────────────────────────────────────────────────────────

/**
 * Parse, validate, and dispatch a raw WebSocket message.
 *
 * @param {import('ws').WebSocket} ws
 * @param {import('ws').RawData} raw
 */
function handleMessage(ws, raw) {
  // 1. Parse JSON.
  let parsed;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    ws.send(makeErrorEnvelope('message is not valid JSON'));
    return;
  }

  // 2. Validate envelope shape.
  const result = validateEnvelope(parsed);
  if (!result.valid) {
    ws.send(makeErrorEnvelope(result.reason));
    return;
  }

  const { type, payload, to } = parsed;

  // 3. Rate-limit all join-room attempts (including malformed payloads).
  if (type === MSG_TYPES.JOIN_ROOM) {
    if (!checkRateLimit(ws._remoteIp)) {
      logger.warn('rate-limited', { ip: ws._remoteIp });
      ws.send(
        makeErrorEnvelope('too many join attempts — please wait before retrying'),
      );
      return;
    }
  }

  // 4. Dispatch by type.
  if (type === MSG_TYPES.JOIN_ROOM) {
    handleJoinRoom(ws, payload);
    return;
  }

  if (ROUTED_TYPES.has(type)) {
    handleRoutedMessage(ws, { type, payload, to });
    return;
  }

  // Any valid non-join, non-routed type that a client shouldn't be sending
  // (e.g. room-joined, peer-joined — those are server→client only).
  ws.send(makeErrorEnvelope(`message type "${type}" cannot be sent by a client`));
}

/**
 * Handle a join-room request.
 *
 * @param {import('ws').WebSocket} ws
 * @param {unknown} payload
 */
function handleJoinRoom(ws, payload) {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    typeof payload.roomId !== 'string'
  ) {
    ws.send(makeErrorEnvelope('"join-room" payload must include a "roomId" string'));
    return;
  }

  const { roomId } = payload;
  const joinResult = joinRoom(ws, roomId);

  if (!joinResult.success) {
    if (joinResult.reason === 'room-full') {
      logger.info('room-full', { roomId });
      ws.send(makeEnvelope(MSG_TYPES.ROOM_FULL, { roomId }));
    } else {
      // invalid-room-id
      ws.send(
        makeErrorEnvelope(
          `invalid roomId "${roomId}" — use 4–64 alphanumeric characters or hyphens`,
        ),
      );
    }
    return;
  }

  const { peerId, isInitiator, existingPeerId } = joinResult;

  // Confirm to the joining peer.
  ws.send(
    makeEnvelope(MSG_TYPES.ROOM_JOINED, {
      roomId,
      peerId,
      isInitiator,
      ...(existingPeerId ? { existingPeerId } : {}),
    }),
  );

  logger.info('room-joined', {
    roomId,
    peerId,
    isInitiator,
    ...(joinResult.existingPeerId
      ? { existingPeerId: joinResult.existingPeerId }
      : {}),
  });
}

/**
 * Handle offer / answer / ice-candidate — relay to the named peer.
 *
 * @param {import('ws').WebSocket} ws
 * @param {{ type: string, payload: unknown, to: string }} envelope
 */
function handleRoutedMessage(ws, envelope) {
  // Sender must already be in a room.
  const meta = getPeerMeta(ws);
  if (!meta) {
    ws.send(makeErrorEnvelope('you must join a room before sending signaling messages'));
    return;
  }

  const relay = relayMessage(ws, envelope);
  if (!relay.relayed) {
    ws.send(makeErrorEnvelope(relay.reason));
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────

// Start the periodic sweep that purges expired rate-limit buckets.
startRateLimitSweep();

server.listen(PORT, () => {
  logger.info('server-started', {
    port: PORT,
    portSource: isPortFromEnv ? 'env' : 'local-default',
    nodeEnv: process.env.NODE_ENV || 'development',
    clientOrigin,
    allowedOrigins: Array.from(ALLOWED_ORIGINS),
  });
});

// Graceful shutdown — give in-flight messages a moment to drain.
function shutdown(signal) {
  logger.info('server-shutting-down', { signal });
  server.close(() => {
    logger.info('server-closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
