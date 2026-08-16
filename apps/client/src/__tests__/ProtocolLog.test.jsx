/**
 * ProtocolLog.test.jsx
 *
 * Unit tests for ProtocolLog component and helper functions:
 *   1. Line-capping behavior (max 50 entries, immediate drop of oldest entry).
 *   2. Relative timestamp computation (mm:ss.ms) from elapsed session time.
 *   3. Event classification styling (.ok, .err, default).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ProtocolLog,
  formatRelativeTimestamp,
  capLogEntries,
  MAX_LOG_ENTRIES,
} from '../components/ProtocolLog.jsx';

describe('formatRelativeTimestamp', () => {
  it('formats 0 milliseconds correctly', () => {
    expect(formatRelativeTimestamp(0)).toBe('00:00.00');
  });

  it('formats relative elapsed milliseconds into mm:ss.ms format', () => {
    expect(formatRelativeTimestamp(20)).toBe('00:00.02');
    expect(formatRelativeTimestamp(1234)).toBe('00:01.23');
    expect(formatRelativeTimestamp(65430)).toBe('01:05.43');
  });

  it('handles negative numbers gracefully by clamping to 0', () => {
    expect(formatRelativeTimestamp(-500)).toBe('00:00.00');
  });
});

describe('capLogEntries line-capping', () => {
  it('maintains up to 50 entries without dropping', () => {
    let entries = [];
    for (let i = 1; i <= 50; i++) {
      entries = capLogEntries(entries, { id: i, elapsedMs: i * 10, htmlMessage: `Entry ${i}`, type: 'info' });
    }
    expect(entries).toHaveLength(50);
    expect(entries[0].id).toBe(1);
    expect(entries[49].id).toBe(50);
  });

  it('immediately drops the oldest entry when 51st entry is added', () => {
    let entries = [];
    for (let i = 1; i <= 50; i++) {
      entries = capLogEntries(entries, { id: i, elapsedMs: i * 10, htmlMessage: `Entry ${i}`, type: 'info' });
    }

    // Add 51st entry
    entries = capLogEntries(entries, { id: 51, elapsedMs: 510, htmlMessage: 'Entry 51', type: 'info' });

    expect(entries).toHaveLength(MAX_LOG_ENTRIES);
    expect(entries[0].id).toBe(2); // Entry 1 dropped immediately
    expect(entries[49].id).toBe(51);
  });

  it('immediately drops entry 2 when 52nd entry is added', () => {
    let entries = [];
    for (let i = 1; i <= 52; i++) {
      entries = capLogEntries(entries, { id: i, elapsedMs: i * 10, htmlMessage: `Entry ${i}`, type: 'info' });
    }

    expect(entries).toHaveLength(50);
    expect(entries[0].id).toBe(3); // Entry 1 and 2 dropped
    expect(entries[49].id).toBe(52);
  });
});

describe('ProtocolLog rendering', () => {
  it('renders placeholder message when logs array is empty', () => {
    render(<ProtocolLog logs={[]} />);
    expect(screen.getByText('protocol log initialized — awaiting connection')).toBeInTheDocument();
  });

  it('renders log lines with formatted relative timestamps and HTML content', () => {
    const logs = [
      { id: 1, elapsedMs: 20, htmlMessage: 'socket connected <b>wss://signal</b>', type: 'info' },
      { id: 2, elapsedMs: 90, htmlMessage: 'peer-joined — negotiating offer/answer', type: 'ok' },
      { id: 3, elapsedMs: 150, htmlMessage: 'connection dropped', type: 'err' },
    ];

    const { container } = render(<ProtocolLog logs={logs} />);

    expect(screen.getByText('00:00.02')).toBeInTheDocument();
    expect(screen.getByText('00:00.09')).toBeInTheDocument();
    expect(screen.getByText('00:00.15')).toBeInTheDocument();

    const okLines = container.querySelectorAll('.log-line.ok');
    const errLines = container.querySelectorAll('.log-line.err');

    expect(okLines).toHaveLength(1);
    expect(errLines).toHaveLength(1);
  });
});
