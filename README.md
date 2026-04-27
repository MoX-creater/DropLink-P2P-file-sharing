# DropLink — P2P File Sharing

A real-time peer-to-peer file transfer system that enables direct browser-to-browser communication using WebRTC. Files are never uploaded to a server — they travel directly between peers over an encrypted data channel.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=nodedotjs&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-Data_Channel-333333?logo=webrtc&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-WebSockets-010101?logo=socketdotio&logoColor=white)

---

## Features

- **Direct P2P Transfer** — Files move directly between browsers via WebRTC Data Channel. No relay server, no cloud upload.
- **Fast Connection** — WebSocket-based signaling establishes peer connections within **1–3 seconds** in local testing.
- **High Throughput** — Achieves **2–8 MB/s** transfer speeds in favorable local conditions.
- **NAT Traversal** — Handles network variability using ICE candidates and Google STUN servers.
- **Real-Time Progress** — Live progress bar with transfer speed (MB/s), percentage, and bytes transferred.
- **Auto-Download** — Received files are automatically downloaded to the receiver's browser.
- **Room-Based Pairing** — Simple 6-character room IDs for easy peer discovery.
- **No File Size Limit** — Transfer any file type, limited only by browser memory.
- **Premium UI** — Dark glassmorphism theme with smooth animations and vibrant gradients.

---

## Tech Stack

| Layer       | Technology                     |
|-------------|--------------------------------|
| Frontend    | React.js, Vite                 |
| Styling     | Vanilla CSS (Glassmorphism)    |
| Real-Time   | WebRTC (RTCPeerConnection, RTCDataChannel) |
| Signaling   | Node.js, Express, Socket.io   |
| NAT/STUN    | Google STUN Servers            |

---

## Architecture

```
┌──────────────────┐         ┌─────────────────────┐         ┌──────────────────┐
│   Browser A      │         │  Signaling Server    │         │   Browser B      │
│                  │         │  (Node.js + Express  │         │                  │
│  React UI        │         │   + Socket.io)       │         │  React UI        │
│  useWebRTC Hook  │◄───────►│  Port 3001           │◄───────►│  useWebRTC Hook  │
│                  │  WS     │                      │  WS     │                  │
│  RTCPeerConn     │         │  - Room management   │         │  RTCPeerConn     │
│                  │         │  - SDP relay         │         │                  │
└────────┬─────────┘         │  - ICE relay         │         └────────┬─────────┘
         │                   └─────────────────────┘                  │
         │                                                            │
         └────────────── WebRTC Data Channel (P2P) ──────────────────┘
                         Direct file transfer
                         64KB chunks + backpressure
```

---

## Project Structure

```
p2p/
├── server/
│   ├── package.json
│   └── index.js                  # Signaling server
│
├── client/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx              # React entry point
│       ├── index.css             # Design system
│       ├── App.jsx               # Main app shell
│       ├── hooks/
│       │   └── useWebRTC.js      # WebRTC + signaling logic
│       └── components/
│           ├── RoomPanel.jsx         # Create/Join room
│           ├── ConnectionStatus.jsx  # Connection indicator
│           ├── FileDropZone.jsx      # Drag & drop file picker
│           ├── FileInfo.jsx          # File preview + send button
│           └── TransferProgress.jsx  # Progress bar + speed stats
│
└── README.md
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- npm

### Installation

```bash
# Clone the repo
git clone https://github.com/your-username/p2p-file-sharing.git
cd p2p-file-sharing

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### Running

Open **two terminal windows**:

```bash
# Terminal 1 — Start the signaling server
cd server
node index.js
# → Signaling server running on http://localhost:3001
```

```bash
# Terminal 2 — Start the React client
cd client
npm run dev
# → React app running on http://localhost:5173
```

### Usage

1. Open **http://localhost:5173** in your browser
2. Click **"✦ Create Room"** — a 6-character Room ID is generated
3. Copy the Room ID and open **http://localhost:5173** in a **second browser window**
4. Paste the Room ID and click **"Join →"**
5. Once connected, **drag & drop a file** (or click to browse) and hit **"⬆ Send"**
6. The file transfers directly to the other browser and auto-downloads

---

## How It Works

### Signaling Flow

```
Host                    Server                    Peer
 │                        │                        │
 ├── join-room ──────────►│                        │
 │                        │◄────── join-room ──────┤
 │◄── peer-joined ───────│                        │
 │                        │                        │
 ├── webrtc-offer ───────►│── webrtc-offer ───────►│
 │                        │◄── webrtc-answer ──────┤
 │◄── webrtc-answer ─────│                        │
 │                        │                        │
 │◄─── ICE candidates ───┼─── ICE candidates ────►│
 │                        │                        │
 ╠════ WebRTC Data Channel (direct P2P) ══════════╣
```

### File Transfer

1. Sender reads the file as an `ArrayBuffer`
2. File is split into **64KB chunks**
3. Metadata (filename, size) is sent first as JSON
4. Chunks are sent sequentially with **backpressure control** (waits if `bufferedAmount` is too high)
5. Receiver accumulates chunks and triggers `file-end` download

---

## Performance

| Metric               | Value               |
|----------------------|---------------------|
| Connection Time      | 1–3 seconds (local) |
| Transfer Speed       | 2–8 MB/s (local)    |
| Chunk Size           | 64 KB               |
| Max Peers per Room   | 2                   |

---

## License

MIT
