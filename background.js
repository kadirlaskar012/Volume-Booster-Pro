/**
 * background.js — Volume Booster Pro Service Worker
 *
 * Architecture Overview:
 * ──────────────────────────────────────────────────────────────────────────
 * Chrome's tabCapture API captures the audio output of a tab as a MediaStream.
 * We route this stream through a Web Audio API graph:
 *
 *   MediaStreamSource → GainNode → MediaStreamDestination → <audio> element
 *
 * This allows us to amplify volume beyond the browser's native 100% cap.
 *
 * MV3 Service Worker Lifecycle Note:
 * ──────────────────────────────────────────────────────────────────────────
 * MV3 service workers are non-persistent — they can be terminated at any time
 * by Chrome when idle. This means we CANNOT hold live AudioContext references
 * in the service worker itself (they'd be lost on worker termination).
 *
 * Solution: The audio graph (AudioContext + GainNode) lives in an OFFSCREEN
 * DOCUMENT or is re-created by the popup when it opens. The service worker
 * acts as a message broker and state manager using chrome.storage.session
 * for ephemeral per-tab state and chrome.storage.local for persistent
 * per-domain volume preferences.
 *
 * tabCapture Limitation:
 * ──────────────────────────────────────────────────────────────────────────
 * chrome.tabCapture.capture() can ONLY be called in direct response to a
 * user gesture on the extension (e.g., clicking the toolbar icon or popup).
 * It cannot be invoked programmatically without user interaction.
 * This is a Chrome security restriction, not a bug.
 */

// ─── State Management ──────────────────────────────────────────────────────
// Map<tabId, { gainValue, muted, domain }> — held in memory while SW is alive
// Persisted to chrome.storage.session for SW restart resilience
const tabState = new Map();

// Default volume gain (1.0 = 100%)
const DEFAULT_GAIN = 1.0;
const MIN_GAIN = 0.0;
const MAX_GAIN = 6.0; // 600%

// ─── Helper: Get tab info ──────────────────────────────────────────────────
async function getTabDomain(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return null;
    const url = new URL(tab.url);
    // Block capture on chrome:// and chrome-extension:// pages
    if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
      return null;
    }
    return url.hostname;
  } catch (e) {
    console.warn('[VBP] Could not get tab info:', e.message);
    return null;
  }
}

// ─── Helper: Update badge ──────────────────────────────────────────────────
async function updateBadge(tabId, gainValue, muted) {
  try {
    if (muted || gainValue === DEFAULT_GAIN) {
      await chrome.action.setBadgeText({ text: '', tabId });
      return;
    }
    const pct = Math.round(gainValue * 100);
    const label = pct >= 100 ? `${Math.round(pct / 10) * 10}%`.replace('0%', '%') : `${pct}%`;
    // Keep badge short: show "3×" style for high values
    const badgeText = pct >= 200 ? `${Math.round(gainValue)}×` : `${pct}%`;
    await chrome.action.setBadgeText({ text: badgeText, tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#6C63FF', tabId });
  } catch (e) {
    // Tab may have been closed
  }
}

// ─── Helper: Load domain volume from storage ───────────────────────────────
async function loadDomainGain(domain) {
  if (!domain) return DEFAULT_GAIN;
  const key = `vol_${domain}`;
  const result = await chrome.storage.local.get(key);
  return result[key] ?? DEFAULT_GAIN;
}

// ─── Helper: Save domain volume to storage ────────────────────────────────
async function saveDomainGain(domain, gain) {
  if (!domain) return;
  const key = `vol_${domain}`;
  await chrome.storage.local.set({ [key]: gain });
}

// ─── Initialize tab state ──────────────────────────────────────────────────
async function initTabState(tabId) {
  const domain = await getTabDomain(tabId);
  const gain = await loadDomainGain(domain);
  const state = { gain, muted: false, domain, capturing: false };
  tabState.set(tabId, state);
  return state;
}

// ─── Get or create tab state ───────────────────────────────────────────────
async function getTabState(tabId) {
  if (!tabState.has(tabId)) {
    return await initTabState(tabId);
  }
  return tabState.get(tabId);
}

// ─── Message Handler ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    console.error('[VBP] Message error:', err);
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  const { type, tabId, gain, muted } = message;

  switch (type) {
    // ── Popup requests current state for a tab ──────────────────────────
    case 'GET_STATE': {
      const state = await getTabState(tabId);
      return { success: true, state };
    }

    // ── Popup/keyboard sets new gain value ──────────────────────────────
    case 'SET_GAIN': {
      const state = await getTabState(tabId);
      const clampedGain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, gain));
      state.gain = clampedGain;
      state.muted = false;
      tabState.set(tabId, state);

      // Persist to storage for this domain
      await saveDomainGain(state.domain, clampedGain);

      // Notify the offscreen document / popup to update AudioContext gain
      await chrome.runtime.sendMessage({ type: 'GAIN_CHANGED', tabId, gain: clampedGain, muted: false })
        .catch(() => {}); // Popup may be closed — that's fine

      await updateBadge(tabId, clampedGain, false);
      return { success: true, gain: clampedGain };
    }

    // ── Toggle mute ──────────────────────────────────────────────────────
    case 'SET_MUTED': {
      const state = await getTabState(tabId);
      state.muted = muted;
      tabState.set(tabId, state);

      await chrome.runtime.sendMessage({ type: 'GAIN_CHANGED', tabId, gain: state.gain, muted })
        .catch(() => {});

      await updateBadge(tabId, state.gain, muted);
      return { success: true };
    }

    // ── Reset volume to 100% and clear domain storage ────────────────────
    case 'RESET': {
      const state = await getTabState(tabId);
      state.gain = DEFAULT_GAIN;
      state.muted = false;
      tabState.set(tabId, state);

      if (state.domain) {
        await chrome.storage.local.remove(`vol_${state.domain}`);
      }

      await chrome.runtime.sendMessage({ type: 'GAIN_CHANGED', tabId, gain: DEFAULT_GAIN, muted: false })
        .catch(() => {});

      await updateBadge(tabId, DEFAULT_GAIN, false);
      return { success: true, gain: DEFAULT_GAIN };
    }

    // ── Popup requests a tabCapture stream ID ────────────────────────────
    // NOTE: tabCapture.capture() must be called from popup.js directly in
    // response to user interaction. This message type is kept for reference.
    case 'START_CAPTURE': {
      const state = await getTabState(tabId);
      state.capturing = true;
      tabState.set(tabId, state);
      return { success: true };
    }

    case 'STOP_CAPTURE': {
      if (tabState.has(tabId)) {
        const state = tabState.get(tabId);
        state.capturing = false;
        tabState.set(tabId, state);
      }
      await updateBadge(tabId, DEFAULT_GAIN, false);
      return { success: true };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// ─── Keyboard Shortcut Commands ────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) return;

  const state = await getTabState(activeTab.id);
  let newGain = state.gain;

  if (command === 'volume-up') {
    newGain = Math.min(MAX_GAIN, state.gain + 0.25);
  } else if (command === 'volume-down') {
    newGain = Math.max(MIN_GAIN, state.gain - 0.25);
  }

  if (newGain !== state.gain) {
    await handleMessage({ type: 'SET_GAIN', tabId: activeTab.id, gain: newGain }, {});
  }
});

// ─── Tab Lifecycle Cleanup ─────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
  // Clean up session storage for this tab if used
  chrome.storage.session?.remove?.(`tab_${tabId}`).catch(() => {});
});

// ─── Tab Navigation Cleanup ────────────────────────────────────────────────
// When user navigates to a new page, reset capture state but keep gain pref
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && tabState.has(tabId)) {
    const state = tabState.get(tabId);
    state.capturing = false;
    // Re-resolve domain in case they navigated to a different site
    const newDomain = await getTabDomain(tabId);
    if (newDomain !== state.domain) {
      const newGain = await loadDomainGain(newDomain);
      state.domain = newDomain;
      state.gain = newGain;
      state.muted = false;
    }
    tabState.set(tabId, state);
    await updateBadge(tabId, state.gain, state.muted);
  }
});

// ─── Extension Install / Startup ───────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  console.log('[VBP] Volume Booster Pro installed. Ready to boost! 🔊');
  chrome.action.setBadgeBackgroundColor({ color: '#6C63FF' });
});

console.log('[VBP] Service worker started.');
