/**
 * ProtocolLog.jsx — Live protocol log panel showing real lifecycle events.
 *
 * Requirements:
 *   - Auto-scroll to newest entry.
 *   - Cap displayed history at max 50 entries (drops oldest entry immediately).
 *   - Display relative timestamp (mm:ss.ms) calculated from session start.
 *   - Render <b> tags in event text for key values (room codes, peer ids, urls).
 *   - Apply .ok (green), .err (red), or default dim text colors based on status.
 */
import { useEffect, useRef } from 'react';
import { Panel } from './Panel.jsx';

/**
 * Format relative elapsed milliseconds into mm:ss.ms format.
 * Example: 20ms -> "00:00.02"
 */
export function formatRelativeTimestamp(elapsedMs) {
  const totalMs = Math.max(0, elapsedMs);
  const mins = Math.floor(totalMs / 60000).toString().padStart(2, '0');
  const secs = Math.floor((totalMs % 60000) / 1000).toString().padStart(2, '0');
  const ms = Math.floor((totalMs % 1000) / 10).toString().padStart(2, '0');
  return `${mins}:${secs}.${ms}`;
}

/** Max lines allowed in log history */
export const MAX_LOG_ENTRIES = 50;

/**
 * Helper to cap log entries array to max 50 items.
 */
export function capLogEntries(entries, newEntry) {
  const updated = [...entries, newEntry];
  if (updated.length > MAX_LOG_ENTRIES) {
    return updated.slice(updated.length - MAX_LOG_ENTRIES);
  }
  return updated;
}

export function ProtocolLog({ logs = [] }) {
  const logBodyRef = useRef(null);

  useEffect(() => {
    if (logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <Panel title="protocol log" status="live" className="log-panel">
      <div className="log-body" ref={logBodyRef}>
        {logs.length === 0 ? (
          <div className="log-line">
            <span className="t">00:00.00</span>
            <span className="ev">protocol log initialized — awaiting connection</span>
          </div>
        ) : (
          logs.map((entry, index) => {
            const timeStr = formatRelativeTimestamp(entry.elapsedMs);
            const lineClass = entry.type === 'ok' ? 'log-line ok' : entry.type === 'err' ? 'log-line err' : 'log-line';

            return (
              <div key={entry.id ?? index} className={lineClass}>
                <span className="t">{timeStr}</span>
                <span
                  className="ev"
                  dangerouslySetInnerHTML={{ __html: entry.htmlMessage ?? entry.message }}
                />
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}
