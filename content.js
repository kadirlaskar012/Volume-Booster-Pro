/**
 * content.js — Volume Booster Pro (Optional Content Script)
 *
 * This content script is OPTIONAL for the MVP. It runs on every page and
 * can be used for future enhancements such as:
 *   - Detecting when audio/video elements start playing on the page
 *   - Auto-triggering the boost when media begins
 *   - Reading page-level volume state
 *
 * For the current MVP, the actual volume boosting is done via tabCapture +
 * Web Audio API in popup.js — no content script injection is required.
 *
 * The content script is currently NOT registered in manifest.json to keep
 * the extension lightweight. Uncomment the content_scripts entry in
 * manifest.json when needed.
 */

'use strict';

// ─── Detect active media on the page ──────────────────────────────────────
function hasActiveAudio() {
  const mediaElements = document.querySelectorAll('audio, video');
  for (const el of mediaElements) {
    if (!el.paused && !el.muted && el.volume > 0) {
      return true;
    }
  }
  return false;
}

// ─── Listen for messages from popup/background ─────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'HAS_AUDIO':
      sendResponse({ hasAudio: hasActiveAudio() });
      break;
    case 'GET_MEDIA_INFO': {
      const mediaElements = [...document.querySelectorAll('audio, video')];
      const info = mediaElements.map(el => ({
        tag: el.tagName.toLowerCase(),
        src: el.currentSrc || el.src || 'unknown',
        paused: el.paused,
        volume: el.volume,
        muted: el.muted,
        duration: el.duration,
      }));
      sendResponse({ media: info });
      break;
    }
    default:
      sendResponse({ error: 'Unknown message type' });
  }
  return true; // Keep async channel open
});

// ─── Notify popup if media starts playing (future use) ────────────────────
// This could be used to auto-activate the booster when audio starts.
document.addEventListener('play', (e) => {
  if (e.target.tagName === 'AUDIO' || e.target.tagName === 'VIDEO') {
    chrome.runtime.sendMessage({ type: 'MEDIA_STARTED', tabId: null }).catch(() => {});
  }
}, true);

console.log('[VBP Content] Content script loaded on', window.location.hostname);
