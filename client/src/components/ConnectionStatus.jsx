import React from 'react';

const statusConfig = {
  idle: null,
  connecting: {
    className: 'connection-status--connecting',
    label: 'Establishing connection…',
  },
  connected: {
    className: 'connection-status--connected',
    label: 'Peer connected — ready to transfer',
  },
  disconnected: {
    className: 'connection-status--disconnected',
    label: 'Peer disconnected',
  },
};

export default function ConnectionStatus({ status }) {
  const config = statusConfig[status];
  if (!config) return null;

  return (
    <div id="connection-status" className={`connection-status ${config.className}`}>
      <span className="connection-status__dot" />
      <span>{config.label}</span>
      {status === 'connecting' && <span className="spinner" style={{ marginLeft: 'auto' }} />}
    </div>
  );
}
