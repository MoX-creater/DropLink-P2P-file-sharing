/**
 * ErrorBanner — terminal error card component.
 *
 * Renders nothing when `message` is null/empty.
 */

import { Button } from './Button.jsx';

/**
 * @param {{ message: string | null, action?: string, onAction?: () => void }} props
 */
export function ErrorBanner({ message, action, onAction }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="panel"
      style={{
        borderColor: 'var(--red)',
        padding: '14px 16px',
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--red)', flexShrink: 0 }} aria-hidden>⚠</span>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            {message}
          </p>

          {action && onAction && (
            <div style={{ marginTop: 10 }}>
              <Button variant="danger" onClick={onAction}>
                {action}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
