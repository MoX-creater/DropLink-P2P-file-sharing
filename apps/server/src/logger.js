/**
 * Structured logger — thin wrapper around process.stdout/stderr.
 * Outputs newline-delimited JSON so log aggregators can parse it easily,
 * while remaining readable enough in a dev terminal.
 *
 * Shape of every log line:
 *   { ts, level, event, ...fields }
 */

const LEVELS = /** @type {const} */ ({
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
});

const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

/**
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} event   Short machine-readable event name, e.g. "peer-joined"
 * @param {Record<string, unknown>} [fields]  Extra structured context.
 */
function log(level, event, fields = {}) {
  if (LEVELS[level] < MIN_LEVEL) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };

  const line = JSON.stringify(entry);

  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (event, fields) => log('debug', event, fields),
  info: (event, fields) => log('info', event, fields),
  warn: (event, fields) => log('warn', event, fields),
  error: (event, fields) => log('error', event, fields),
};
