import React, { useState, useRef } from 'react';

export default function FileDropZone({ disabled, onFileSelected }) {
  const [isDragActive, setIsDragActive] = useState(false);
  const inputRef = useRef(null);

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (disabled) return;
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      onFileSelected(files[0]);
    }
  };

  const handleInputChange = (e) => {
    if (e.target.files.length > 0) {
      onFileSelected(e.target.files[0]);
    }
  };

  return (
    <div
      id="file-drop-zone"
      className={`file-drop-zone ${isDragActive ? 'file-drop-zone--active' : ''} ${disabled ? 'file-drop-zone--disabled' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <div className="file-drop-zone__icon">
        {isDragActive ? '🎯' : '📁'}
      </div>
      <div className="file-drop-zone__text">
        {disabled ? (
          'Connect to a peer to start sharing files'
        ) : isDragActive ? (
          <strong>Release to select file</strong>
        ) : (
          <>
            <strong>Click or drag & drop</strong> a file here
          </>
        )}
      </div>
      {!disabled && (
        <div className="file-drop-zone__hint">
          Any file type · No size limit (browser memory dependent)
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleInputChange}
        tabIndex={-1}
      />
    </div>
  );
}
