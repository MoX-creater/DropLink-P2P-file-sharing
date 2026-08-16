/**
 * ErrorBanner — full-width contextual error card.
 *
 * Used when a terminal error state needs more explanation + a CTA
 * than the StatusPanel's single-line error string can give.
 *
 * Renders nothing when `message` is null/empty.
 */

import { color, font, space, radius, transition } from '../styles/glass.js';

/**
 * @param {{ message: string | null, action?: string, onAction?: () => void }} props
 */
export function ErrorBanner({ message, action, onAction }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      style={{
        display:      'flex',
        alignItems:   'flex-start',
        gap:          space[3],
        padding:      `${space[4]}px ${space[5]}px`,
        background:   'rgba(239, 68, 68, 0.08)',
        border:       '1px solid rgba(239, 68, 68, 0.22)',
        borderRadius: radius.lg,
        marginBottom: space[4],
      }}
    >
      {/* Icon */}
      <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1.6 }} aria-hidden>⚠</span>

      {/* Message + optional action */}
      <div style={{ flex: 1 }}>
        <p style={{
          margin:     0,
          fontSize:   font.size.sm,
          color:      color.textSecondary,
          lineHeight: 1.6,
        }}>
          {message}
        </p>

        {action && onAction && (
          <button
            onClick={onAction}
            style={{
              marginTop:    space[2],
              padding:      `${space[1]}px ${space[3]}px`,
              background:   'rgba(239,68,68,0.12)',
              border:       '1px solid rgba(239,68,68,0.30)',
              borderRadius: radius.sm,
              color:        color.danger,
              fontSize:     font.size.xs,
              fontWeight:   font.weight.semibold,
              cursor:       'pointer',
              transition:   transition.fast,
            }}
          >
            {action}
          </button>
        )}
      </div>
    </div>
  );
}
