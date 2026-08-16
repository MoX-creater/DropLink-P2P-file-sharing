/**
 * Panel.jsx — Single reusable structural unit for terminal visual layout.
 *
 * Bordered container with panel-head strip (title left, status/value right, uppercase).
 */
export function Panel({ title, status, className = '', children, ...props }) {
  return (
    <div className={`panel ${className}`.trim()} {...props}>
      {(title || status) && (
        <div className="panel-head">
          <span>{title}</span>
          {status && <span>{status}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
