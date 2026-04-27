import React, { useState } from 'react';
import { useWebRTC } from './hooks/useWebRTC.js';
import RoomPanel from './components/RoomPanel.jsx';
import ConnectionStatus from './components/ConnectionStatus.jsx';
import FileDropZone from './components/FileDropZone.jsx';
import FileInfo from './components/FileInfo.jsx';
import TransferProgress from './components/TransferProgress.jsx';

export default function App() {
  const {
    connectionStatus,
    roomId,
    isHost,
    transferState,
    createRoom,
    joinRoom,
    sendFile,
    disconnect,
  } = useWebRTC();

  const [selectedFile, setSelectedFile] = useState(null);

  const isConnected = connectionStatus === 'connected';
  const isSending = transferState?.direction === 'send' && transferState?.status === 'transferring';

  const handleFileSelected = (file) => {
    setSelectedFile(file);
  };

  const handleSend = () => {
    if (selectedFile && isConnected) {
      sendFile(selectedFile);
    }
  };

  const handleClearFile = () => {
    setSelectedFile(null);
  };

  const handleDisconnect = () => {
    setSelectedFile(null);
    disconnect();
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <h1 className="header__logo">DropLink</h1>
        <p className="header__tagline">
          Peer-to-peer file sharing · Powered by WebRTC
        </p>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Room Panel */}
        <RoomPanel
          roomId={roomId}
          isHost={isHost}
          connectionStatus={connectionStatus}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          onDisconnect={handleDisconnect}
        />

        {/* Connection Status */}
        <ConnectionStatus status={connectionStatus} />

        {/* File Transfer Area */}
        {(isConnected || connectionStatus === 'connecting') && (
          <>
            {/* File Selection */}
            {!selectedFile && !transferState && (
              <FileDropZone
                disabled={!isConnected}
                onFileSelected={handleFileSelected}
              />
            )}

            {/* Selected File Preview */}
            {selectedFile && !transferState && (
              <FileInfo
                file={selectedFile}
                onSend={handleSend}
                onClear={handleClearFile}
                sending={isSending}
              />
            )}

            {/* Transfer Progress */}
            <TransferProgress transferState={transferState} />
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>
          End-to-end encrypted · No files stored on server · Direct browser-to-browser transfer
        </p>
      </footer>
    </div>
  );
}
