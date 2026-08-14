import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  }),
);

// Health check
app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

const server = createServer(app);

// WebSocket server — attached to the same HTTP server.
// No signaling logic yet; that's Phase 1.
const _wss = new WebSocketServer({ server });

// TODO (Phase 1): The `cors` middleware above only covers Express HTTP routes.
// WebSocket upgrade requests bypass Express middleware entirely, so origin-
// checking for WS connections must be handled manually in a
// `server.on('upgrade', ...)` handler. Implement this when adding signaling
// logic to prevent unauthorized origins from establishing WS connections.

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`\n🚀 Signaling server running on http://localhost:${PORT}\n`);
});
