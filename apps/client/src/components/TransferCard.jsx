/**
 * TransferCard.jsx — Stacked transfer row component inside the master TRANSFERS panel.
 *
 * Renders file name, transfer metadata, rectangular progress bar, status text, and action buttons.
 */
import { TRANSFER_STATUS, formatBytes } from '../hooks/transferProtocol.js';

const TX_LABEL = {
  [TRANSFER_STATUS.PENDING]:            'Pending',
  [TRANSFER_STATUS.TRANSFERRING]:       'Transferring',
  [TRANSFER_STATUS.PAUSED]:             'Paused',
  [TRANSFER_STATUS.RESUMING]:           'Resuming…',
  [TRANSFER_STATUS.COMPLETE]:           'Complete',
  [TRANSFER_STATUS.CANCELLED]:          'Cancelled',
  [TRANSFER_STATUS.INTEGRITY_MISMATCH]: 'Integrity mismatch',
  [TRANSFER_STATUS.ERROR]:              'Error',
  [TRANSFER_STATUS.INTERRUPTED]:        'Interrupted',
};

const DIR_ICON = { send: '↑', receive: '↓' };
const DIR_LABEL = { send: 'Sending', receive: 'Receiving' };

const ACTIVE = new Set([
  TRANSFER_STATUS.TRANSFERRING,
  TRANSFER_STATUS.PAUSED,
  TRANSFER_STATUS.RESUMING,
]);

export function TransferCard({ transfer: t, onCancel, onPause, onResume }) {
  const pct        = Math.round((t.progress || 0) * 100);
  const isActive   = ACTIVE.has(t.status);
  const canPause   = t.direction === 'send' && t.status === TRANSFER_STATUS.TRANSFERRING;
  const canResume  = t.direction === 'send' && t.status === TRANSFER_STATUS.PAUSED;
  const canCancel  = isActive;

  const isComplete = t.status === TRANSFER_STATUS.COMPLETE;
  const isError    = t.status === TRANSFER_STATUS.ERROR || t.status === TRANSFER_STATUS.INTERRUPTED || t.status === TRANSFER_STATUS.INTEGRITY_MISMATCH;

  return (
    <div className="transfer-row">
      <div className="transfer-header">
        <span className="transfer-file-name" title={t.name}>
          {DIR_ICON[t.direction]} {t.name}
        </span>
        <span className="transfer-meta">
          {isComplete ? (
            <b style={{ color: 'var(--green)' }}>✓ complete</b>
          ) : (
            <span style={{ color: isError ? 'var(--red)' : 'var(--text-dim)' }}>
              {TX_LABEL[t.status] ?? t.status}
            </span>
          )}
        </span>
      </div>

      <div className="transfer-meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{DIR_LABEL[t.direction]} · {formatBytes(t.size)}</span>
        {isActive && (
          <span>
            {t.speedBps > 0 && t.status === TRANSFER_STATUS.TRANSFERRING
              ? `${formatBytes(t.speedBps)}/s · `
              : ''}
            {pct}%
          </span>
        )}
      </div>

      {isActive && (
        <div className="progress-bar-bg">
          <div
            className={`progress-bar-fill ${isComplete ? 'complete' : isError ? 'error' : ''}`.trim()}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Detail messages */}
      {t.sinkWarning && (
        <div style={{ fontSize: 11, color: 'var(--amber)' }}>
          ⚠ {t.sinkWarning}
        </div>
      )}

      {t.error && (
        <div style={{ fontSize: 11, color: 'var(--red)' }}>
          {t.error}
        </div>
      )}

      {/* Action buttons */}
      {(canPause || canResume || canCancel) && (
        <div className="transfer-actions">
          {canPause && (
            <button className="transfer-btn" onClick={onPause}>pause</button>
          )}
          {canResume && (
            <button className="transfer-btn" onClick={onResume}>resume</button>
          )}
          {canCancel && (
            <button className="transfer-btn" onClick={onCancel}>cancel</button>
          )}
        </div>
      )}
    </div>
  );
}
