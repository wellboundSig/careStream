/**
 * Multi-window helpers: BroadcastChannel state sync + pop-out window management.
 *
 * BroadcastChannel lets multiple same-origin windows share Zustand state changes
 * without duplicate API calls. The main window runs sync polling; pop-out windows
 * receive updates via broadcast only.
 */

const CHANNEL_NAME = 'carestream-sync';

let channel = null;
let _suppress = false;

export function getBroadcastChannel() {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

export function isPopOutWindow() {
  try {
    return new URLSearchParams(window.location.search).has('popout');
  } catch {
    return false;
  }
}

export function openPopOut(path = '/') {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${path}${sep}popout=true`;
  const win = window.open(url, `cs-${Date.now()}`, 'width=1200,height=800');
  if (!win) alert('Pop-up blocked — please allow pop-ups for CareStream.');
  return win;
}

export function isBroadcastSuppressed() {
  return _suppress;
}

export function suppressBroadcast(fn) {
  _suppress = true;
  try { fn(); } finally { _suppress = false; }
}
