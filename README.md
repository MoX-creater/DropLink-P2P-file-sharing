# DropLink

> Browser-to-browser file transfer — no servers touch your files.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=nodedotjs&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-Data_Channel-333333?logo=webrtc&logoColor=white)
![WebSocket](https://img.shields.io/badge/Signaling-ws-000000?logo=websocket&logoColor=white)
<!-- TODO: Add build status badge once CI badge URL is available -->

**[Live demo](https://drop-link-p2-p-file-sharing-client.vercel.app/)** — open it in two tabs (or two devices) to try a real transfer.
<!-- TODO: replace with your actual Vercel URL -->

---

## Overview

DropLink sends files directly between two browsers over a WebRTC data channel. A lightweight signaling server only helps two peers find each other and exchange connection metadata (SDP offers/answers, ICE candidates) — it never sees file contents, never stores anything, and the file data flows peer-to-peer once the connection is established.

Large files are streamed to disk via the File System Access API rather than buffered in memory, and every transfer is verified end-to-end with a SHA-256 hash comparison.

> [!NOTE]
> The signaling server runs on Render's free tier, which spins down after periods of inactivity. The first connection after idle time may take 30–60 seconds to wake it up.

---

## Architecture

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────┐
│  Browser A   │       │ Signaling Server │       │  Browser B   │
│  (React)     │◄─────►│ (Express + ws)   │◄─────►│  (React)     │
└──────┬───────┘  WS   └──────────────────┘  WS   └──────┬───────┘
       │                                                   │
       └──────────── WebRTC Data Channel (P2P) ───────────┘
                     Direct file transfer, hash-verified
```

The signaling server's only job is routing three message types — `offer`, `answer`, and `ice-candidate` — between two peers in a room, capped at 2 peers per room, with origin allowlisting and per-IP rate limiting on room creation. Once the data channel opens, the server is no longer in the data path at all.

---

## Features

- **Peer-to-peer transfer** — files never pass through a server, only connection metadata does
- **Streaming writes** — large files write directly to disk via the File System Access API instead of buffering in memory (with an in-memory fallback for browsers that don't support it, e.g. Firefox/Safari)
- **Integrity verification** — SHA-256 hash computed on both ends and compared on completion
- **Backpressure-aware chunked transfer** — 64KB chunks with `bufferedAmount`-based flow control
- **Pause / resume / cancel** mid-transfer
- **Resilient signaling** — distinct states for room-full, room-not-found, ICE failure, and peer disconnect, with automatic ICE restart on transient drops
- **Room TTL and rate limiting** on the signaling server to prevent abandoned rooms and abuse

---

## Tech Stack

| Layer     | Technology                                 |
| --------- | ------------------------------------------ |
| Frontend  | React, Vite                                |
| Styling   | Vanilla CSS                                |
| Real-Time | WebRTC (RTCPeerConnection, RTCDataChannel) |
| Signaling | Node.js, Express, ws (WebSocket)           |
| NAT/STUN  | Google STUN servers (STUN-only, no TURN fallback yet) |
| Testing   | Vitest                                     |

---

## Project Structure

```
DropLink-P2P-file-sharing/
├── .github/workflows/ci.yml
├── apps/
│   ├── client/          # React + Vite (Vercel)
│   │   ├── src/
│   │   ├── index.html
│   │   ├── vite.config.js
│   │   └── package.json
│   └── server/          # Express + ws (Render)
│       ├── src/
│       └── package.json
├── eslint.config.js
├── .prettierrc
├── package.json         # npm workspaces root
└── README.md
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- npm v9+

### Installation

```bash
# Clone the repo
git clone https://github.com/MoX-creater/DropLink-P2P-file-sharing.git
cd DropLink-P2P-file-sharing

# Install all dependencies (root + workspaces)
npm install

# Copy environment files
cp apps/client/.env.example apps/client/.env
cp apps/server/.env.example apps/server/.env
```

### Development

```bash
# Start both client and server concurrently
npm run dev

# Or run individually
npm run dev:client   # Vite on http://localhost:5173
npm run dev:server   # Express on http://localhost:3001
```

### Testing

```bash
npm test
```

### Build

```bash
npm run build
```

---

## Deployment

| App    | Platform | Notes                                                        |
| ------ | -------- | ------------------------------------------------------------- |
| Client | Vercel   | Root directory `apps/client`, set `VITE_SIGNALING_URL` to the server's `wss://` URL |
| Server | Render   | Root directory `apps/server`, free tier — requires persistent WebSocket support (not serverless/edge) |

### Server (Render)

1. New Web Service → connect this repo → root directory `apps/server`
2. Build command: `npm install`
3. Start command: `npm start`
4. Environment variables:
   ```
   ALLOWED_ORIGINS=https://drop-link-p2-p-file-sharing-client.vercel.app/
   CLIENT_ORIGIN=https://drop-link-p2-p-file-sharing-client.vercel.app/
   ```
   (`PORT` is injected automatically — don't set it manually)

### Client (Vercel)

1. Add New Project → import this repo → root directory `apps/client`
2. Framework preset: Vite (auto-detected)
3. Environment variables:
   ```
   VITE_SIGNALING_URL=wss://droplink-p2p-file-sharing.onrender.com/
   ```

---

## Known Limitations

- **STUN-only** — no TURN fallback, so connections behind symmetric NATs (common on some corporate/mobile networks) may fail. TURN support is a planned addition.
- **Free-tier cold starts** — the signaling server sleeps after inactivity on Render's free plan; first connection after idle time is slow.
- **No multi-file queue** — one file transfer at a time per session (by design, for this version).

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request
