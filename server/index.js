const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Track rooms: roomId -> Set of socket IDs
const rooms = new Map();

io.on("connection", (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  // --- Join a room ---
  socket.on("join-room", (roomId) => {
    // Create the room set if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }

    const room = rooms.get(roomId);

    // Limit to 2 peers per room
    if (room.size >= 2) {
      socket.emit("room-full");
      return;
    }

    room.add(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;

    console.log(`🚪 ${socket.id} joined room ${roomId} (${room.size}/2)`);

    // Notify the joining peer about existing peers
    const peers = [...room].filter((id) => id !== socket.id);
    socket.emit("room-joined", { roomId, peers });

    // Notify existing peers about the new joiner
    socket.to(roomId).emit("peer-joined", { peerId: socket.id });
  });

  // --- WebRTC Signaling: Offer ---
  socket.on("webrtc-offer", ({ offer, to }) => {
    console.log(`📡 Offer from ${socket.id} to ${to}`);
    io.to(to).emit("webrtc-offer", { offer, from: socket.id });
  });

  // --- WebRTC Signaling: Answer ---
  socket.on("webrtc-answer", ({ answer, to }) => {
    console.log(`📡 Answer from ${socket.id} to ${to}`);
    io.to(to).emit("webrtc-answer", { answer, from: socket.id });
  });

  // --- WebRTC Signaling: ICE Candidate ---
  socket.on("webrtc-ice-candidate", ({ candidate, to }) => {
    io.to(to).emit("webrtc-ice-candidate", { candidate, from: socket.id });
  });

  // --- Disconnect ---
  socket.on("disconnect", () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.delete(socket.id);

      // Notify remaining peers
      socket.to(roomId).emit("peer-left", { peerId: socket.id });

      // Cleanup empty rooms
      if (room.size === 0) {
        rooms.delete(roomId);
        console.log(`🗑️  Room ${roomId} deleted (empty)`);
      }
    }
  });
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ status: "ok", rooms: rooms.size });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 Signaling server running on http://localhost:${PORT}\n`);
});
