/**
 * Button.jsx — Reusable terminal command button.
 *
 * Transparent background, amber-dim border, amber text, `$ ` prefix via ::before.
 * Supports variants: 'primary' (default), 'secondary', 'danger'.
 */
export function Button({ variant = 'primary', className = '', children, ...props }) {
  const variantClass = variant === 'secondary'
    ? 'btn-secondary'
    : variant === 'danger'
    ? 'btn-danger'
    : '';

  return (
    <button className={`btn ${variantClass} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
