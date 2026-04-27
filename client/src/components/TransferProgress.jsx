import React from 'react';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec === 0) return '—';
  return formatBytes(bytesPerSec) + '/s';
}

export default function TransferProgress({ transferState }) {
  if (!transferState) return null;

  const { direction, fileName, fileSize, transferred, speed, status } = transferState;
  const percent = fileSize > 0 ? Math.min((transferred / fileSize) * 100, 100) : 0;

  if (status === 'complete') {
    return (
      <div className="glass-card transfer-complete">
        <div className="transfer-complete__icon">✅</div>
        <div className="transfer-complete__title">
          {direction === 'send' ? 'File Sent!' : 'File Received!'}
        </div>
        <div className="transfer-complete__subtitle">
          <strong>{fileName}</strong> ({formatBytes(fileSize)}) transferred successfully
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card transfer-progress">
      <div className="transfer-progress__header">
        <span className="transfer-progress__label">
          {direction === 'send' ? '⬆️ Sending' : '⬇️ Receiving'}: {fileName}
        </span>
        <span className="transfer-progress__percentage">{percent.toFixed(1)}%</span>
      </div>

      <div className="transfer-progress__bar-bg">
        <div
          className="transfer-progress__bar-fill"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="transfer-progress__stats">
        <span className="transfer-progress__stat">
          📊 {formatBytes(transferred)} / {formatBytes(fileSize)}
        </span>
        <span className="transfer-progress__stat">
          ⚡ {formatSpeed(speed)}
        </span>
      </div>
    </div>
  );
}
