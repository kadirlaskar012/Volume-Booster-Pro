/**
 * background.js — Volume Booster Pro Service Worker (MV3 Offscreen Coordinator)
 *
 * Architecture:
 * ──────────────────────────────────────────────────────────────────────────
 * - Manages extension lifecycle, keyboard shortcuts, and domain persistence.
 * - Coordinates the Chrome Offscreen Document (offscreen.html) which hosts
 *   the live Web Audio API graph persistently.
 * - When the user closes the popup or switches tabs, the offscreen document
 *   remains alive, ensuring continuous, uninterrupted 600% volume boosting.
 */

'use strict';

// ─── Constants ─────────────────────────────────────────────────────────────
const DEFAULT_GAIN = 1.0;
const MIN_GAIN     = 0.0;
const MAX_GAIN     = 6.0;

// Tab State Map: Map<tabId, { gain, muted, domain, capturing, bass, eqMode, pan }>
const tabState = new Map();

// ─── Offscreen Document Lifecycle ──────────────────────────────────────────
async function hasOffscreenDocument() {
  if (chrome.offscreen && typeof chrome.offscreen.hasDocument === 'function') {
    return await chrome.offscreen.hasDocument();
  }
  if (chrome.runtime && typeof chrome.runtime.getContexts === 'function') {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    return contexts.length > 0;
  }
  return false;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Volume Booster Pro continuous Web Audio API amplification'
    });
    console.log('[VBP Background] Offscreen document created successfully.');
  } catch (err) {
    if (!err.message.includes('Only a single offscreen document may be created')) {
      console.error('[VBP Background] Failed to create offscreen document:', err);
      throw err;
    }
  }
}

// ─── Tab Info & Domain Helpers ─────────────────────────────────────────────
async function getTabDomain(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return null;
    const url = new URL(tab.url);
    if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:' || url.protocol === 'edge:') {
      return null;
    }
    return url.hostname;
  } catch (e) {
    return null;
  }
}

async function loadDomainSettings(domain) {
  if (!domain || !chrome?.storage?.local) {
    return { gain: DEFAULT_GAIN, bass: 0, eqMode: 'balanced', pan: 0 };
  }
  const key = `vol_${domain}`;
  const res = await chrome.storage.local.get(key);
  const saved = res[key];
  if (typeof saved === 'number') {
    return { gain: saved, bass: 0, eqMode: 'balanced', pan: 0 };
  }
  return {
    gain: saved?.gain ?? DEFAULT_GAIN,
    bass: saved?.bass ?? 0,
    eqMode: saved?.eqMode ?? 'balanced',
    pan: saved?.pan ?? 0
  };
}

async function saveDomainSettings(domain, state) {
  if (!domain || !chrome?.storage?.local) return;
  const key = `vol_${domain}`;
  const data = {
    gain: state.gain,
    bass: state.bass,
    eqMode: state.eqMode,
    pan: state.pan
  };
  await chrome.storage.local.set({ [key]: data }).catch(() => {});
}

async function initTabState(tabId) {
  const domain = await getTabDomain(tabId);
  const settings = await loadDomainSettings(domain);
  const state = {
    gain: settings.gain,
    bass: settings.bass,
    eqMode: settings.eqMode,
    pan: settings.pan,
    muted: false,
    domain,
    capturing: false
  };
  tabState.set(tabId, state);
  return state;
}

async function getTabState(tabId) {
  if (!tabState.has(tabId)) {
    return await initTabState(tabId);
  }
  return tabState.get(tabId);
}

// ─── Dynamic Badge Updates ─────────────────────────────────────────────────
async function updateBadge(tabId, gainValue, muted, capturing) {
  try {
    if (!capturing || muted || gainValue === DEFAULT_GAIN) {
      await chrome.action.setBadgeText({ text: '', tabId });
      return;
    }

    const pct = Math.round(gainValue * 100);
    const badgeText = pct >= 200 ? `${(pct / 100).toFixed(1).replace('.0', '')}×` : `${pct}%`;
    await chrome.action.setBadgeText({ text: badgeText, tabId });

    let badgeColor = '#8B5CF6'; // Purple (1–150%)
    if (pct > 400) {
      badgeColor = '#EF4444'; // Red (401%+)
    } else if (pct > 150) {
      badgeColor = '#2563EB'; // Blue (151–400%)
    }

    await chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId });
  } catch (e) {}
}

// ─── Message Handling ──────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // If message is targeted to offscreen, ignore it in background
  if (message.target === 'offscreen') return false;

  handleMessage(message, sender).then(sendResponse).catch((err) => {
    console.error('[VBP Background] Message error:', err);
    sendResponse({ error: err.message });
  });
  return true; // Keep async channel open
});

async function handleMessage(message, sender) {
  const { type, tabId } = message;

  switch (type) {
    // ── Popup queries current state ──
    case 'GET_STATE': {
      const state = await getTabState(tabId);
      // Verify with offscreen document whether capture is truly running
      if (await hasOffscreenDocument()) {
        try {
          const res = await chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'IS_CAPTURING',
            tabId
          });
          if (res && typeof res.capturing === 'boolean') {
            state.capturing = res.capturing;
          }
        } catch {}
      } else {
        state.capturing = false;
      }
      return { success: true, state };
    }

    // ── Start Audio Capture via Offscreen Document ──
    case 'START_CAPTURE': {
      const state = await getTabState(tabId);
      await ensureOffscreenDocument();

      // Obtain mediaStreamId for this tab
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

      // Instruct offscreen document to capture and start DSP
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'START_CAPTURE',
        tabId,
        streamId,
        gain: state.gain,
        bass: state.bass,
        eqMode: state.eqMode,
        pan: state.pan,
        muted: state.muted
      });

      if (response?.error) {
        throw new Error(response.error);
      }

      state.capturing = true;
      tabState.set(tabId, state);
      await updateBadge(tabId, state.gain, state.muted, true);
      return { success: true, state };
    }

    // ── Stop Audio Capture ──
    case 'STOP_CAPTURE': {
      const state = await getTabState(tabId);
      state.capturing = false;
      tabState.set(tabId, state);

      if (await hasOffscreenDocument()) {
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'STOP_CAPTURE',
          tabId
        }).catch(() => {});
      }

      await updateBadge(tabId, state.gain, false, false);
      return { success: true };
    }

    // ── Set Gain Level ──
    case 'SET_GAIN': {
      const state = await getTabState(tabId);
      const clampedGain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, message.gain));
      state.gain = clampedGain;
      state.muted = false;
      tabState.set(tabId, state);

      if (state.capturing && (await hasOffscreenDocument())) {
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'SET_GAIN',
          tabId,
          gain: clampedGain
        }).catch(() => {});
      }

      await saveDomainSettings(state.domain, state);
      await updateBadge(tabId, clampedGain, false, state.capturing);
      return { success: true, gain: clampedGain };
    }

    // ── Sub-Bass Control ──
    case 'SET_BASS': {
      const state = await getTabState(tabId);
      state.bass = Math.min(15, Math.max(0, message.bass));
      tabState.set(tabId, state);

      if (state.capturing && (await hasOffscreenDocument())) {
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'SET_BASS',
          tabId,
          bass: state.bass
        }).catch(() => {});
      }

      await saveDomainSettings(state.domain, state);
      return { success: true };
    }

    // ── EQ Profile Selection ──
    case 'SET_EQ_PROFILE': {
      const state = await getTabState(tabId);
      state.eqMode = message.eqMode;
      tabState.set(tabId, state);

      if (state.capturing && (await hasOffscreenDocument())) {
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'SET_EQ_PROFILE',
          tabId,
          eqMode: state.eqMode
        }).catch(() => {});
      }

      await saveDomainSettings(state.domain, state);
      return { success: true };
    }

    // ── Stereo Pan ──
    case 'SET_PAN': {
      const state = await getTabState(tabId);
      state.pan = Math.min(1.0, Math.max(-1.0, message.pan));
      tabState.set(tabId, state);

      if (state.capturing && (await hasOffscreenDocument())) {
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'SET_PAN',
          tabId,
          pan: state.pan
        }).catch(() => {});
      }

      await saveDomainSettings(state.domain, state);
      return { success: true };
    }

    // ── Mute Toggle ──
    case 'SET_MUTED': {
      const state = await getTabState(tabId);
      state.muted = message.muted;
      tabState.set(tabId, state);

      if (state.capturing && (await hasOffscreenDocument())) {
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'SET_MUTED',
          tabId,
          muted: state.muted
        }).catch(() => {});
      }

      await updateBadge(tabId, state.gain, state.muted, state.capturing);
      return { success: true };
    }

    // ── Reset to 100% ──
    case 'RESET': {
      const state = await getTabState(tabId);
      state.gain = DEFAULT_GAIN;
      state.bass = 0;
      state.eqMode = 'balanced';
      state.pan = 0;
      state.muted = false;
      tabState.set(tabId, state);

      if (state.domain && chrome?.storage?.local) {
        await chrome.storage.local.remove(`vol_${state.domain}`).catch(() => {});
      }

      if (state.capturing && (await hasOffscreenDocument())) {
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'SET_GAIN',
          tabId,
          gain: DEFAULT_GAIN
        }).catch(() => {});
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'SET_BASS',
          tabId,
          bass: 0
        }).catch(() => {});
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'SET_EQ_PROFILE',
          tabId,
          eqMode: 'balanced'
        }).catch(() => {});
        await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'SET_PAN',
          tabId,
          pan: 0
        }).catch(() => {});
      }

      await updateBadge(tabId, DEFAULT_GAIN, false, state.capturing);
      return { success: true, state };
    }

    // ── Notification from Offscreen document when track ended ──
    case 'TAB_CAPTURE_ENDED': {
      if (tabState.has(tabId)) {
        const state = tabState.get(tabId);
        state.capturing = false;
        await updateBadge(tabId, state.gain, false, false);
      }
      return { success: true };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// ─── Global Keyboard Shortcuts ─────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || !activeTab.id) return;

  const state = await getTabState(activeTab.id);
  let newGain = state.gain;

  if (command === 'volume-up') {
    newGain = Math.min(MAX_GAIN, state.gain + 0.25);
  } else if (command === 'volume-down') {
    newGain = Math.max(MIN_GAIN, state.gain - 0.25);
  }

  if (newGain !== state.gain) {
    // If not capturing yet and volume is increased, auto-start capture
    if (!state.capturing && newGain > DEFAULT_GAIN) {
      try {
        await handleMessage({ type: 'START_CAPTURE', tabId: activeTab.id }, {});
      } catch {}
    }
    await handleMessage({ type: 'SET_GAIN', tabId: activeTab.id, gain: newGain }, {});
  }
});

// ─── Tab Cleanup ───────────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (await hasOffscreenDocument()) {
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'STOP_CAPTURE',
      tabId
    }).catch(() => {});
  }
  tabState.delete(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && tabState.has(tabId)) {
    const state = tabState.get(tabId);
    state.capturing = false;
    const newDomain = await getTabDomain(tabId);
    if (newDomain !== state.domain) {
      state.domain = newDomain;
      const settings = await loadDomainSettings(newDomain);
      state.gain = settings.gain;
      state.bass = settings.bass;
      state.eqMode = settings.eqMode;
      state.pan = settings.pan;
      state.muted = false;
    }
    tabState.set(tabId, state);
    await updateBadge(tabId, state.gain, state.muted, false);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[VBP] Volume Booster Pro v2.0 installed. Offscreen audio engine ready! 🔊');
});
