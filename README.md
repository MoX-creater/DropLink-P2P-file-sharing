# DropLink

<!-- TODO: Add project logo/banner -->

> Browser-to-browser file transfer — no servers touch your files.

<!-- Badges -->

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=nodedotjs&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-Data_Channel-333333?logo=webrtc&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)
<!-- TODO: Add build status badge once CI is connected -->

---

## Overview

<!-- TODO: Write a 2-3 sentence product description -->

---

## Architecture

<!-- TODO: Replace with actual architecture diagram (Excalidraw, Mermaid, or ASCII art) -->

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────┐
│  Browser A   │       │ Signaling Server │       │  Browser B   │
│  (React)     │◄─────►│ (Express + ws)   │◄─────►│  (React)     │
└──────┬───────┘  WS   └──────────────────┘  WS   └──────┬───────┘
       │                                                   │
       └──────────── WebRTC Data Channel (P2P) ───────────┘
                     Direct file transfer
```

---

## Tech Stack

| Layer     | Technology                                 |
| --------- | ------------------------------------------ |
| Frontend  | React, Vite                                |
| Styling   | Vanilla CSS                                |
| Real-Time | WebRTC (RTCPeerConnection, RTCDataChannel) |
| Signaling | Node.js, Express, ws (WebSocket)           |
| NAT/STUN  | Google STUN Servers                        |

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
│   └── server/          # Express + ws (Render / Fly.io)
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
git clone https://github.com/<your-username>/DropLink-P2P-file-sharing.git
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

### Build

```bash
npm run build
```

---

## Deployment

<!-- TODO: Add Vercel deploy instructions for client -->
<!-- TODO: Add Render / Fly.io deploy instructions for server -->

| App    | Platform        | Notes                             |
| ------ | --------------- | --------------------------------- |
| Client | Vercel          | <!-- TODO: Add deploy details --> |
| Server | Render / Fly.io | Requires persistent WS support    |

---

## Contributing

<!-- TODO: Add contributing guidelines -->

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## License

<!-- TODO: Choose and add license -->

MIT © [Your Name]
