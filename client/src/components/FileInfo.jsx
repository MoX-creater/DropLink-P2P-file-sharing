import React from 'react';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(fileName) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const iconMap = {
    pdf: '📄', doc: '📝', docx: '📝', txt: '📃',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    mp4: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬',
    mp3: '🎵', wav: '🎵', flac: '🎵',
    zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
    js: '💻', jsx: '💻', ts: '💻', py: '💻', java: '💻',
    exe: '⚙️', dmg: '⚙️', msi: '⚙️',
  };
  return iconMap[ext] || '📎';
}

export default function FileInfo({ file, onSend, onClear, sending }) {
  return (
    <div className="glass-card file-info">
      <div className="file-info__icon">{getFileIcon(file.name)}</div>
      <div className="file-info__details">
        <div className="file-info__name">{file.name}</div>
        <div className="file-info__size">{formatBytes(file.size)}</div>
      </div>
      <div className="file-info__actions">
        <button
          id="send-file-btn"
          className="btn btn--primary"
          onClick={onSend}
          disabled={sending}
        >
          {sending ? (
            <>
              <span className="spinner" /> Sending…
            </>
          ) : (
            '⬆ Send'
          )}
        </button>
        <button
          id="clear-file-btn"
          className="btn btn--secondary"
          onClick={onClear}
          disabled={sending}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
