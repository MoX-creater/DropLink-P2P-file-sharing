/**
 * StatusLED.jsx — Connection status LED indicator.
 *
 * Driven by real connection state:
 *   - connected: green LED with pulse animation
 *   - connecting / waiting-for-peer / negotiating / reconnecting: amber LED with pulse
 *   - peer-disconnected / ice-failed / error: red LED
 *   - idle / default: gray LED
 */
import { CONNECTION_STATUS } from '../hooks/usePeerConnection.js';

export function StatusLED({ status }) {
  let ledClass = '';

  if (status === CONNECTION_STATUS.CONNECTED) {
    ledClass = 'live';
  } else if (
    status === CONNECTION_STATUS.CONNECTING ||
    status === CONNECTION_STATUS.WAITING_FOR_PEER ||
    status === CONNECTION_STATUS.NEGOTIATING ||
    status === CONNECTION_STATUS.RECONNECTING
  ) {
    ledClass = 'connecting';
  } else if (
    status === CONNECTION_STATUS.PEER_DISCONNECTED ||
    status === CONNECTION_STATUS.ROOM_FULL ||
    status === CONNECTION_STATUS.INVALID_ROOM ||
    status === CONNECTION_STATUS.ICE_FAILED ||
    status === CONNECTION_STATUS.SIGNALING_ERROR
  ) {
    ledClass = 'error';
  }

  return <span className={`status-led ${ledClass}`.trim()} />;
}
