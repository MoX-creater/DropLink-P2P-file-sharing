import { useState, useRef, useCallback, useEffect } from 'react';
import { io } from 'socket.io-client';

const SIGNALING_SERVER = 'http://localhost:3001';
const CHUNK_SIZE = 64 * 1024; // 64 KB chunks

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function useWebRTC() {
  const [connectionStatus, setConnectionStatus] = useState('idle'); // idle | connecting | connected | disconnected
  const [roomId, setRoomId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [transferState, setTransferState] = useState(null);
  // transferState: { direction: 'send'|'receive', fileName, fileSize, transferred, speed, status: 'transferring'|'complete' }

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const receiveBufferRef = useRef([]);
  const receivedSizeRef = useRef(0);
  const fileMetaRef = useRef(null);
  const speedIntervalRef = useRef(null);
  const lastTransferredRef = useRef(0);

  // ── Cleanup ────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (speedIntervalRef.current) clearInterval(speedIntervalRef.current);
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setConnectionStatus('idle');
    setRoomId('');
    setIsHost(false);
    setTransferState(null);
    receiveBufferRef.current = [];
    receivedSizeRef.current = 0;
    fileMetaRef.current = null;
  }, []);

  // ── Setup data channel event handlers ──────────────────────
  const setupDataChannel = useCallback((channel) => {
    channel.binaryType = 'arraybuffer';
    dataChannelRef.current = channel;

    channel.onopen = () => {
      console.log('📡 Data channel open');
      setConnectionStatus('connected');
    };

    channel.onclose = () => {
      console.log('📡 Data channel closed');
    };

    channel.onmessage = (event) => {
      // If it's a string, it's metadata
      if (typeof event.data === 'string') {
        const meta = JSON.parse(event.data);
        if (meta.type === 'file-meta') {
          fileMetaRef.current = meta;
          receiveBufferRef.current = [];
          receivedSizeRef.current = 0;
          lastTransferredRef.current = 0;

          setTransferState({
            direction: 'receive',
            fileName: meta.fileName,
            fileSize: meta.fileSize,
            transferred: 0,
            speed: 0,
            status: 'transferring',
          });

          // Speed tracking
          if (speedIntervalRef.current) clearInterval(speedIntervalRef.current);
          speedIntervalRef.current = setInterval(() => {
            const currentTransferred = receivedSizeRef.current;
            const bytesPerSec = currentTransferred - lastTransferredRef.current;
            lastTransferredRef.current = currentTransferred;
            setTransferState((prev) =>
              prev ? { ...prev, speed: bytesPerSec, transferred: currentTransferred } : prev
            );
          }, 1000);
        } else if (meta.type === 'file-end') {
          // File transfer complete
          if (speedIntervalRef.current) clearInterval(speedIntervalRef.current);

          const blob = new Blob(receiveBufferRef.current);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileMetaRef.current.fileName;
          a.click();
          URL.revokeObjectURL(url);

          setTransferState((prev) =>
            prev
              ? { ...prev, transferred: prev.fileSize, speed: 0, status: 'complete' }
              : prev
          );

          receiveBufferRef.current = [];
          receivedSizeRef.current = 0;
        }
        return;
      }

      // Binary data — file chunk
      receiveBufferRef.current.push(event.data);
      receivedSizeRef.current += event.data.byteLength;
    };
  }, []);

  // ── Create RTCPeerConnection ───────────────────────────────
  const createPeerConnection = useCallback(
    (socket, remotePeerId) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc-ice-candidate', {
            candidate: event.candidate,
            to: remotePeerId,
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('ICE state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          setConnectionStatus('disconnected');
        }
      };

      pc.ondatachannel = (event) => {
        console.log('📥 Received data channel');
        setupDataChannel(event.channel);
      };

      return pc;
    },
    [setupDataChannel]
  );

  // ── Generate a room ID ────────────────────────────────────
  const generateRoomId = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  };

  // ── Create Room (Host) ────────────────────────────────────
  const createRoom = useCallback(() => {
    cleanup();
    const newRoomId = generateRoomId();
    setRoomId(newRoomId);
    setIsHost(true);
    setConnectionStatus('connecting');

    const socket = io(SIGNALING_SERVER);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('🔌 Connected to signaling server');
      socket.emit('join-room', newRoomId);
    });

    socket.on('room-joined', ({ roomId: rid }) => {
      console.log(`✅ Joined room ${rid} as host`);
    });

    // When a peer joins, host creates the offer
    socket.on('peer-joined', async ({ peerId }) => {
      console.log(`👋 Peer joined: ${peerId}`);
      const pc = createPeerConnection(socket, peerId);

      // Create data channel (host-side)
      const channel = pc.createDataChannel('fileTransfer', {
        ordered: true,
      });
      setupDataChannel(channel);

      // Create & send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', { offer, to: peerId });
    });

    // Handle answer from peer
    socket.on('webrtc-answer', async ({ answer }) => {
      console.log('📥 Received answer');
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    // Handle ICE candidates
    socket.on('webrtc-ice-candidate', async ({ candidate }) => {
      if (pcRef.current) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on('peer-left', () => {
      setConnectionStatus('disconnected');
    });

    socket.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });
  }, [cleanup, createPeerConnection, setupDataChannel]);

  // ── Join Room (Peer) ──────────────────────────────────────
  const joinRoom = useCallback(
    (targetRoomId) => {
      if (!targetRoomId || targetRoomId.trim().length === 0) return;
      cleanup();

      const rid = targetRoomId.trim().toUpperCase();
      setRoomId(rid);
      setIsHost(false);
      setConnectionStatus('connecting');

      const socket = io(SIGNALING_SERVER);
      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('🔌 Connected to signaling server');
        socket.emit('join-room', rid);
      });

      socket.on('room-full', () => {
        alert('Room is full. Only 2 peers allowed.');
        cleanup();
      });

      // Handle offer from host
      socket.on('webrtc-offer', async ({ offer, from }) => {
        console.log('📥 Received offer from', from);
        const pc = createPeerConnection(socket, from);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc-answer', { answer, to: from });
      });

      // Handle ICE candidates
      socket.on('webrtc-ice-candidate', async ({ candidate }) => {
        if (pcRef.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      });

      socket.on('peer-left', () => {
        setConnectionStatus('disconnected');
      });

      socket.on('disconnect', () => {
        setConnectionStatus('disconnected');
      });
    },
    [cleanup, createPeerConnection]
  );

  // ── Send File ──────────────────────────────────────────────
  const sendFile = useCallback((file) => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== 'open') {
      console.error('Data channel not open');
      return;
    }

    // Send metadata first
    channel.send(
      JSON.stringify({
        type: 'file-meta',
        fileName: file.name,
        fileSize: file.size,
      })
    );

    setTransferState({
      direction: 'send',
      fileName: file.name,
      fileSize: file.size,
      transferred: 0,
      speed: 0,
      status: 'transferring',
    });

    const reader = new FileReader();
    let offset = 0;
    lastTransferredRef.current = 0;

    // Speed tracking
    if (speedIntervalRef.current) clearInterval(speedIntervalRef.current);
    speedIntervalRef.current = setInterval(() => {
      const bytesPerSec = offset - lastTransferredRef.current;
      lastTransferredRef.current = offset;
      setTransferState((prev) =>
        prev ? { ...prev, speed: bytesPerSec, transferred: offset } : prev
      );
    }, 1000);

    const readSlice = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
      const buffer = e.target.result;

      // Backpressure: wait until bufferedAmount drops
      const sendChunk = () => {
        if (channel.bufferedAmount > CHUNK_SIZE * 8) {
          setTimeout(sendChunk, 10);
          return;
        }
        channel.send(buffer);
        offset += buffer.byteLength;

        if (offset < file.size) {
          readSlice();
        } else {
          // All chunks sent
          channel.send(JSON.stringify({ type: 'file-end' }));
          if (speedIntervalRef.current) clearInterval(speedIntervalRef.current);
          setTransferState((prev) =>
            prev
              ? { ...prev, transferred: file.size, speed: 0, status: 'complete' }
              : prev
          );
        }
      };
      sendChunk();
    };

    readSlice();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    connectionStatus,
    roomId,
    isHost,
    transferState,
    createRoom,
    joinRoom,
    sendFile,
    disconnect: cleanup,
  };
}
