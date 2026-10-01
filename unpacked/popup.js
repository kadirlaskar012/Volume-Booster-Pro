/**
 * popup.js — Volume Booster Pro (Ultra Edition — Offscreen Persistent Audio)
 *
 * Architecture:
 * ──────────────────────────────────────────────────────────────────────────
 * - Audio graph runs in an isolated Offscreen Document (offscreen.html),
 *   NOT inside the popup window.
 * - When user clicks outside or closes popup, audio REMAINS BOOSTED!
 * - Popup acts as a lightweight, 60fps remote control for the audio engine.
 * - Supports instant 1-click presets, EQ profiles, Sub-bass, and theme toggle.
 */

'use strict';

// ─── Constants ─────────────────────────────────────────────────────────────
const MAX_GAIN     = 6.0;  // 600%
const MIN_GAIN     = 0.0;  // 0%
const DEFAULT_GAIN = 1.0;  // 100%

// ─── Environment Detection ─────────────────────────────────────────────────
const isExtensionContext = typeof chrome !== 'undefined' && !!chrome?.tabs?.query && !!chrome?.runtime?.id;

// ─── DOM References ────────────────────────────────────────────────────────
const volumeSlider        = document.getElementById('volume-slider');
const volumeDisplay       = document.getElementById('volume-display');
const gainSubtext         = document.getElementById('gain-subtext');
const volumeHint          = document.getElementById('volume-hint');
const glowOrb             = document.getElementById('glow-orb');
const domainText          = document.getElementById('domain-text');
const faviconImg          = document.getElementById('favicon-img');
const faviconFallback     = document.getElementById('favicon-fallback');
const captureStatus       = document.getElementById('capture-status');
const boostIndicator      = document.getElementById('boost-indicator');
const boostLabel          = document.getElementById('boost-label');
const errorBanner         = document.getElementById('error-banner');
const errorText           = document.getElementById('error-text');
const btnBoost            = document.getElementById('btn-boost');
const btnBoostText        = document.getElementById('boost-btn-text');
const btnMute             = document.getElementById('btn-mute');
const btnReset            = document.getElementById('btn-reset');
const btnTheme            = document.getElementById('btn-theme');
const themeIconSun        = document.getElementById('theme-icon-sun');
const themeIconMoon       = document.getElementById('theme-icon-moon');
const btnQuickTimer       = document.getElementById('btn-quick-timer');
const topTimerIcon        = document.getElementById('top-timer-icon');
const btnSettings         = document.getElementById('btn-settings');
const btnCloseSettings    = document.getElementById('btn-close-settings');
const settingsPanel       = document.getElementById('settings-panel');
const btnChipNormalizer   = document.getElementById('btn-chip-normalizer');
const btnChipDialogue     = document.getElementById('btn-chip-dialogue');
const btnChipTimer        = document.getElementById('btn-chip-timer');
const chipTimerText       = document.getElementById('chip-timer-text');
const chipTimerNew        = document.getElementById('chip-timer-new');
const btnDrawerNormalizer = document.getElementById('btn-drawer-normalizer');
const btnDrawerDialogue   = document.getElementById('btn-drawer-dialogue');
const drawerTimerStatus   = document.getElementById('drawer-timer-status');
const drawerTimerSub      = document.getElementById('drawer-timer-sub');
const timerPresetBtns     = document.querySelectorAll('.timer-preset-btn');
const presetBtns          = document.querySelectorAll('.preset-btn');
const modeBtns            = document.querySelectorAll('.mode-btn');
const activeProfileName   = document.getElementById('active-profile-name');
const btnEqToggle         = document.getElementById('btn-eq-toggle');
const eqToggleLabel       = document.getElementById('eq-toggle-label');
const modesGrid           = document.querySelector('.modes-grid');
const bassControlWrapper  = document.querySelector('.bass-control-wrapper');
const bassSlider          = document.getElementById('bass-slider');
const bassDbText          = document.getElementById('bass-db-text');
const panSlider           = document.getElementById('pan-slider');
const btnResetPan         = document.getElementById('btn-reset-pan');
const popupVisualizer     = document.getElementById('popup-visualizer');

// ─── Central State Store ───────────────────────────────────────────────────
const state = {
  gain: DEFAULT_GAIN,     // 0.0 to 6.0
  isMuted: false,         // boolean
  isCapturing: false,     // boolean: true when tab is amplified via offscreen
  domain: '',             // active hostname
  tabId: null,            // active tab id
  bass: 0,                // Sub-bass boost: 0 to 15 dB
  eqMode: 'balanced',     // 'balanced' | 'bass' | 'vocal' | 'cinema'
  eqEnabled: false,       // boolean: EQ is bypassed/off by default
  normalizer: false,      // boolean: Auto Volume Normalizer
  dialogueClarity: false, // boolean: Dialogue Clarity / Voice Mode
  sleepTimer: null,       // { active: false, remainingSec: 0, totalMinutes: 0 }
  pan: 0,                 // Stereo pan: -1.0 to +1.0
  theme: 'dark'           // 'dark' | 'light'
};

// ─── Sound Profile EQ Definitions (Fine-Tuned Studio Parameters) ───────────
const EQ_PRESETS = {
  balanced: { bassAdd: 0,    midGain: 0,    highGain: 0,   label: 'Balanced',   color: '#38BDF8' },
  bass:     { bassAdd: 4.5,  midGain: -1.0, highGain: 1.0, label: 'Bass Boost', color: '#8B5CF6' },
  vocal:    { bassAdd: -1.5, midGain: 2.5,  highGain: 1.5, label: 'Vocal Clear', color: '#10B981' },
  cinema:   { bassAdd: 3.0,  midGain: -1.0, highGain: 2.5, label: 'Cinema 3D',  color: '#EC4899' }
};

// ─── Visualizer & Simulation References ────────────────────────────────────
let vizCtx         = null;
let vizAnimId      = null;
let vizPollTimer   = null;
let cachedFreqData = null;
let previewSynth   = null; // Only used in standalone non-extension preview.html

// ─── Debouncing & RAF Optimization ─────────────────────────────────────────
let rafSyncId      = null;
let saveDebounceId = null;

function scheduleSyncUI() {
  if (rafSyncId) return;
  rafSyncId = requestAnimationFrame(() => {
    rafSyncId = null;
    syncUI();
  });
}

function scheduleSaveSettings(immediate = false) {
  if (saveDebounceId) clearTimeout(saveDebounceId);
  if (immediate) {
    sendStateToBackground('SET_GAIN', { gain: state.gain });
  } else {
    saveDebounceId = setTimeout(() => {
      sendStateToBackground('SET_GAIN', { gain: state.gain });
    }, 150);
  }
}

async function sendStateToBackground(type, payload = {}) {
  if (!isExtensionContext || !state.tabId) return;
  return await chrome.runtime.sendMessage({
    type,
    tabId: state.tabId,
    ...payload
  }).catch(() => null);
}

// ─── Unified UI Synchronization ────────────────────────────────────────────
function syncUI() {
  const effectiveGain = state.isMuted ? 0 : state.gain;
  const actualPct = Math.round(state.gain * 100);
  const effectivePct = Math.round(effectiveGain * 100);

  // 1. Slider value and dynamic gradient track
  if (volumeSlider) {
    volumeSlider.value = actualPct;
    const fillPercentage = (actualPct / 600) * 100;
    const fillStop = actualPct >= 400 ? '#F59E0B' : (actualPct >= 150 ? '#6366F1' : '#38BDF8');
    volumeSlider.style.background = `linear-gradient(to right, ${fillStop} ${fillPercentage}%, var(--slider-track) ${fillPercentage}%)`;
  }

  // 2. Big Percentage Number & Ambient Glow
  if (volumeDisplay) {
    if (state.isMuted) {
      volumeDisplay.textContent = 'MUTED';
      if (gainSubtext) gainSubtext.textContent = `${actualPct}% (sound muted)`;
      volumeDisplay.className = 'volume-number tier-muted';
      if (volumeHint) volumeHint.classList.add('hidden');
    } else if (effectivePct === 0) {
      volumeDisplay.textContent = '0%';
      if (gainSubtext) gainSubtext.textContent = '0.00× (Silenced)';
      volumeDisplay.className = 'volume-number tier-idle';
      if (volumeHint) volumeHint.classList.add('hidden');
    } else {
      volumeDisplay.textContent = `${effectivePct}%`;
      if (gainSubtext) {
        if (effectivePct === 100) {
          gainSubtext.textContent = '1.00× (Baseline)';
        } else {
          gainSubtext.textContent = `${state.gain.toFixed(2)}× gain`;
        }
      }
      if (volumeHint) volumeHint.classList.add('hidden');

      let tier = 'tier-normal';
      if (effectivePct >= 500)      tier = 'tier-max';
      else if (effectivePct >= 400) tier = 'tier-warning';
      else if (effectivePct > 200)  tier = 'tier-high';
      else if (effectivePct > 100)  tier = 'tier-boosted';

      volumeDisplay.className = `volume-number ${tier}`;
    }
  }

  // 3. Dynamic Glow Orb
  if (glowOrb) {
    if (state.isMuted || effectivePct === 0) {
      glowOrb.style.background = 'radial-gradient(ellipse at 50% 0%, rgba(100, 116, 139, 0.12) 0%, transparent 70%)';
    } else if (effectivePct >= 400) {
      glowOrb.style.background = 'radial-gradient(ellipse at 50% 0%, rgba(245, 158, 11, 0.3) 0%, transparent 70%)';
    } else if (effectivePct > 100) {
      glowOrb.style.background = 'radial-gradient(ellipse at 50% 0%, rgba(139, 92, 246, 0.3) 0%, transparent 70%)';
    } else {
      glowOrb.style.background = 'radial-gradient(ellipse at 50% 0%, rgba(6, 182, 212, 0.25) 0%, transparent 70%)';
    }
  }

  // 4. 4-Tier Dynamic Status Dot & Label
  if (boostIndicator && boostLabel) {
    boostIndicator.className = 'status-dot';
    boostLabel.className = 'status-label';

    if (effectivePct === 0 || state.isMuted) {
      boostLabel.textContent = 'IDLE';
      boostLabel.classList.add('status-idle');
      boostIndicator.classList.add('status-idle');
    } else if (effectivePct <= 100) {
      boostLabel.textContent = 'BOOSTING';
      boostLabel.classList.add('status-boosting');
      boostIndicator.classList.add('status-boosting');
    } else if (effectivePct < 400) {
      boostLabel.textContent = 'BOOSTED';
      boostLabel.classList.add('status-boosted');
      boostIndicator.classList.add('status-boosted');
    } else {
      boostLabel.textContent = 'HIGH BOOST ⚠️';
      boostLabel.classList.add('status-warning');
      boostIndicator.classList.add('status-warning');
    }
  }

  // 5. Boost Button State & Label Sync
  if (btnBoost && btnBoostText) {
    btnBoost.classList.remove('state-active', 'state-inactive');
    if (state.isCapturing && effectiveGain > 0) {
      btnBoost.classList.add('state-active');
      btnBoostText.textContent = 'Boost Active';
    } else {
      btnBoost.classList.add('state-inactive');
      btnBoostText.textContent = 'Enable Boost';
    }
  }

  // 6. Preset Buttons
  presetBtns.forEach(btn => {
    const val = parseInt(btn.dataset.value, 10);
    btn.classList.toggle('active', val === actualPct && !state.isMuted);
  });

  // 7. Mute Button
  if (btnMute) {
    btnMute.classList.toggle('muted', state.isMuted);
    btnMute.title = state.isMuted ? 'Unmute' : 'Mute';
  }

  // 8. Capture Status Badge
  if (captureStatus) {
    captureStatus.classList.remove('hidden', 'status-active', 'status-inactive');
    if (state.isCapturing) {
      captureStatus.textContent = '● Active';
      captureStatus.classList.add('status-active');
    } else {
      captureStatus.textContent = '○ Inactive';
      captureStatus.classList.add('status-inactive');
    }
  }

  // 9. Sub-Bass & EQ Profiles
  if (bassSlider) bassSlider.value = state.bass;
  if (bassDbText) bassDbText.textContent = `+${state.bass} dB`;
  if (panSlider) panSlider.value = state.pan;

  // EQ ON/OFF Button & Container State
  if (btnEqToggle && eqToggleLabel) {
    if (state.eqEnabled) {
      btnEqToggle.className = 'eq-toggle-btn eq-on';
      btnEqToggle.title = 'Equalizer Active — Click to Bypass';
      eqToggleLabel.textContent = 'ON';
    } else {
      btnEqToggle.className = 'eq-toggle-btn eq-off';
      btnEqToggle.title = 'Equalizer Bypassed — Click to Enable';
      eqToggleLabel.textContent = 'OFF';
    }
  }

  if (modesGrid) {
    modesGrid.classList.toggle('disabled', !state.eqEnabled);
  }
  if (bassControlWrapper) {
    bassControlWrapper.classList.toggle('disabled', !state.eqEnabled);
  }

  modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === state.eqMode && state.eqEnabled);
  });

  const currentPreset = EQ_PRESETS[state.eqMode] || EQ_PRESETS.balanced;
  if (activeProfileName) {
    if (state.eqEnabled) {
      activeProfileName.textContent = currentPreset.label;
      activeProfileName.style.color = currentPreset.color;
      activeProfileName.classList.remove('bypassed');
    } else {
      activeProfileName.textContent = 'BYPASS';
      activeProfileName.style.color = '';
      activeProfileName.classList.add('bypassed');
    }
  }

  // 10. Smart Tools: Auto Normalizer
  if (btnChipNormalizer) {
    btnChipNormalizer.classList.toggle('active-cyan', !!state.normalizer);
  }
  if (btnDrawerNormalizer) {
    btnDrawerNormalizer.classList.toggle('active', !!state.normalizer);
  }

  // 11. Smart Tools: Dialogue Clarity
  if (btnChipDialogue) {
    btnChipDialogue.classList.toggle('active-purple', !!state.dialogueClarity);
  }
  if (btnDrawerDialogue) {
    btnDrawerDialogue.classList.toggle('active', !!state.dialogueClarity);
  }

  // 12. Smart Tools: Sleep Timer
  const isTimerActive = !!(state.sleepTimer?.active && state.sleepTimer?.remainingSec > 0);
  if (isTimerActive) {
    const timeFormatted = formatTimer(state.sleepTimer.remainingSec);
    if (chipTimerText) chipTimerText.textContent = `⏳ ${timeFormatted}`;
    if (chipTimerNew) chipTimerNew.classList.add('hidden');
    if (btnChipTimer) btnChipTimer.classList.add('active-emerald');
    if (drawerTimerStatus) {
      drawerTimerStatus.textContent = `⏳ ${timeFormatted}`;
      drawerTimerStatus.classList.add('active');
    }
    if (drawerTimerSub) drawerTimerSub.textContent = 'Smooth fade-out in final 60s';
    if (topTimerIcon) topTimerIcon.textContent = '⏳';

    timerPresetBtns.forEach(btn => {
      const min = parseInt(btn.dataset.minutes, 10);
      btn.classList.toggle('active', min === state.sleepTimer.totalMinutes);
    });
  } else {
    if (chipTimerText) chipTimerText.textContent = 'Timer: Off';
    if (chipTimerNew) chipTimerNew.classList.remove('hidden');
    if (btnChipTimer) btnChipTimer.classList.remove('active-emerald');
    if (drawerTimerStatus) {
      drawerTimerStatus.textContent = 'Off';
      drawerTimerStatus.classList.remove('active');
    }
    if (drawerTimerSub) drawerTimerSub.textContent = 'Auto fade-out & stop';
    if (topTimerIcon) topTimerIcon.textContent = '⏰';

    timerPresetBtns.forEach(btn => {
      const min = parseInt(btn.dataset.minutes, 10);
      btn.classList.toggle('active', min === 0);
    });
  }
}

// ─── Sleep Timer Countdown & Formatter ─────────────────────────────────────
let timerTickerInterval = null;

function formatTimer(totalSec) {
  if (totalSec <= 0) return '0:00';
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}h ${remM}m`;
  }
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function startTimerTicker() {
  if (timerTickerInterval) clearInterval(timerTickerInterval);
  timerTickerInterval = setInterval(() => {
    if (state.sleepTimer && state.sleepTimer.active && state.sleepTimer.remainingSec > 0) {
      state.sleepTimer.remainingSec--;
      if (state.sleepTimer.remainingSec <= 0) {
        state.sleepTimer.active = false;
        state.isCapturing = false;
        clearInterval(timerTickerInterval);
        timerTickerInterval = null;
      }
      scheduleSyncUI();
    } else {
      if (timerTickerInterval) {
        clearInterval(timerTickerInterval);
        timerTickerInterval = null;
      }
    }
  }, 1000);
}

// ─── Smart Tool Mutators ───────────────────────────────────────────────────
async function toggleNormalizer(notify = true) {
  state.normalizer = !state.normalizer;
  scheduleSyncUI();
  if (notify && isExtensionContext) {
    await sendStateToBackground('SET_NORMALIZER', { enabled: state.normalizer });
  }
}

async function toggleDialogueClarity(notify = true) {
  state.dialogueClarity = !state.dialogueClarity;
  scheduleSyncUI();
  if (notify && isExtensionContext) {
    await sendStateToBackground('SET_DIALOGUE_CLARITY', { enabled: state.dialogueClarity });
  }
}

async function setSleepTimer(minutes, notify = true) {
  if (!state.isCapturing && minutes > 0) {
    await startCapture();
  }

  if (notify && isExtensionContext) {
    const res = await sendStateToBackground('SET_SLEEP_TIMER', { minutes });
    if (res && res.success) {
      state.sleepTimer = {
        active: res.active,
        remainingSec: res.remainingSec,
        totalMinutes: res.totalMinutes
      };
    } else {
      state.sleepTimer = { active: false, remainingSec: 0, totalMinutes: 0 };
    }
  } else {
    // Standalone fallback
    if (minutes > 0) {
      state.sleepTimer = {
        active: true,
        remainingSec: minutes * 60,
        totalMinutes: minutes
      };
    } else {
      state.sleepTimer = { active: false, remainingSec: 0, totalMinutes: 0 };
    }
  }

  if (state.sleepTimer && state.sleepTimer.active) {
    startTimerTicker();
  } else if (timerTickerInterval) {
    clearInterval(timerTickerInterval);
    timerTickerInterval = null;
  }

  scheduleSyncUI();
}

// ─── Theme Management (Light / Dark) ───────────────────────────────────────
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  if (themeIconSun && themeIconMoon) {
    if (theme === 'light') {
      themeIconSun.classList.add('hidden');
      themeIconMoon.classList.remove('hidden');
      if (btnTheme) btnTheme.title = 'Switch to Dark Theme';
    } else {
      themeIconSun.classList.remove('hidden');
      themeIconMoon.classList.add('hidden');
      if (btnTheme) btnTheme.title = 'Switch to Light Theme';
    }
  }

  if (chrome?.storage?.local) {
    chrome.storage.local.set({ app_theme: theme }).catch(() => {});
  }
}

function toggleTheme() {
  const newTheme = state.theme === 'light' ? 'dark' : 'light';
  applyTheme(newTheme);
}

// ─── State Mutation Handlers ───────────────────────────────────────────────
async function setGain(newGain, immediateSave = false) {
  state.gain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, newGain));
  state.isMuted = false;

  scheduleSyncUI();

  // If not capturing yet and user boosts above 100%, automatically start capture!
  if (!state.isCapturing && state.gain > 1.0) {
    await startCapture();
  } else {
    scheduleSaveSettings(immediateSave);
  }
}

async function applyEqProfile(mode, notify = true) {
  state.eqMode = mode;
  scheduleSyncUI();
  if (notify && isExtensionContext) {
    await sendStateToBackground('SET_EQ_PROFILE', { eqMode: mode });
  }
}

async function applyBass(bassValue, notify = true) {
  state.bass = Math.min(15, Math.max(0, bassValue));
  if (bassDbText) bassDbText.textContent = `+${state.bass} dB`;
  if (notify && isExtensionContext) {
    await sendStateToBackground('SET_BASS', { bass: state.bass });
  }
}

async function applyPan(panValue, notify = true) {
  state.pan = Math.min(1.0, Math.max(-1.0, panValue));
  if (panSlider) panSlider.value = state.pan;
  if (notify && isExtensionContext) {
    await sendStateToBackground('SET_PAN', { pan: state.pan });
  }
}

async function toggleMute() {
  state.isMuted = !state.isMuted;
  scheduleSyncUI();
  if (isExtensionContext) {
    await sendStateToBackground('SET_MUTED', { muted: state.isMuted });
  }
}

async function resetVolume() {
  state.gain = DEFAULT_GAIN;
  state.isMuted = false;
  state.bass = 0;
  state.eqMode = 'balanced';
  state.eqEnabled = false;
  state.normalizer = false;
  state.dialogueClarity = false;
  state.sleepTimer = null;
  state.pan = 0;

  if (timerTickerInterval) {
    clearInterval(timerTickerInterval);
    timerTickerInterval = null;
  }

  scheduleSyncUI();
  hideError();

  if (isExtensionContext) {
    await sendStateToBackground('RESET');
  }
}

// ─── Live Popup Mini Spectrum Visualizer ───────────────────────────────────
function setupVisualizer() {
  if (!popupVisualizer) return;
  const dpr = window.devicePixelRatio || 1;
  const rectWidth = 280;
  const rectHeight = 16;
  popupVisualizer.width = rectWidth * dpr;
  popupVisualizer.height = rectHeight * dpr;
  vizCtx = popupVisualizer.getContext('2d');
  vizCtx.scale(dpr, dpr);
}

function startVisualizer() {
  setupVisualizer();

  // Poll offscreen document for FFT audio data while popup is open
  if (isExtensionContext) {
    if (vizPollTimer) clearInterval(vizPollTimer);
    vizPollTimer = setInterval(async () => {
      if (!state.isCapturing || state.isMuted) return;
      try {
        const res = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'GET_METRICS',
          tabId: state.tabId
        });
        if (res?.data && res.data.length > 0) {
          cachedFreqData = new Uint8Array(res.data);
        }
      } catch {}
    }, 60);
  }

  if (vizAnimId) cancelAnimationFrame(vizAnimId);
  drawPopupVisualizer();
}

function drawPopupVisualizer() {
  vizAnimId = requestAnimationFrame(drawPopupVisualizer);
  if (!popupVisualizer || !vizCtx) return;

  const width = 280;
  const height = 16;

  vizCtx.clearRect(0, 0, width, height);

  const numBars = 20;
  const barGap = 3;
  const barWidth = (width - (numBars - 1) * barGap) / numBars;

  const effectiveGain = state.isMuted ? 0 : state.gain;
  const actualPct = Math.round(effectiveGain * 100);

  let gradColor1 = '#06B6D4';
  if (actualPct >= 400) {
    gradColor1 = '#F59E0B';
  } else if (actualPct > 150) {
    gradColor1 = '#8B5CF6';
  }

  const hasAudioData = cachedFreqData && cachedFreqData.length > 0;

  for (let i = 0; i < numBars; i++) {
    let barHeight = 2;

    if (state.isCapturing && !state.isMuted) {
      if (hasAudioData) {
        const binIdx = Math.min(cachedFreqData.length - 1, Math.floor(i * (cachedFreqData.length / numBars)));
        const rawAmp = cachedFreqData[binIdx] / 255;
        const boostMultiplier = 0.5 + 0.5 * (effectiveGain / 6.0);
        barHeight = Math.max(2, rawAmp * (height - 2) * boostMultiplier);
      } else {
        // Idle ambient wave while boosting
        const time = Date.now() * 0.003;
        barHeight = 2 + Math.sin(time + i * 0.4) * 1.5;
      }
    }

    const x = i * (barWidth + barGap);
    const y = height - barHeight;

    vizCtx.fillStyle = gradColor1;
    vizCtx.fillRect(x, y, barWidth, barHeight);
  }
}

// ─── Start Tab Audio Capture (Offscreen Architecture) ──────────────────────
async function startCapture() {
  if (state.isCapturing) return;

  if (btnBoostText) btnBoostText.textContent = 'Connecting…';
  if (btnBoost) btnBoost.disabled = true;
  hideError();

  try {
    // ── Standalone Preview Fallback (Non-extension testbench) ──
    if (!isExtensionContext) {
      state.isCapturing = true;
      if (btnBoost) btnBoost.disabled = false;
      startVisualizer();
      scheduleSyncUI();
      return;
    }

    // ── Real Chrome Extension: Obtain streamId via user gesture ──
    let streamId = null;
    if (chrome.tabCapture && typeof chrome.tabCapture.getMediaStreamId === 'function') {
      streamId = await new Promise((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: state.tabId }, (id) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          resolve(id);
        });
      }).catch(() => null);
    }

    // Instruct background service worker & offscreen document to start capture
    const response = await chrome.runtime.sendMessage({
      type: 'START_CAPTURE',
      tabId: state.tabId,
      streamId: streamId
    });

    if (response?.error) {
      throw new Error(response.error);
    }

    state.isCapturing = true;
    if (btnBoost) btnBoost.disabled = false;

    startVisualizer();
    scheduleSyncUI();

  } catch (err) {
    console.error('[VBP Popup] Capture failed:', err);
    state.isCapturing = false;
    if (btnBoost) btnBoost.disabled = false;
    scheduleSyncUI();

    let friendlyMsg = err.message || 'Could not capture tab audio.';
    if (friendlyMsg.includes('already active') || friendlyMsg.includes('already captured')) {
      friendlyMsg = 'Audio capture is already active on this tab. Boost is enabled!';
      state.isCapturing = true;
      startVisualizer();
      scheduleSyncUI();
      return;
    } else if (friendlyMsg.includes('permission')) {
      friendlyMsg = 'Permission denied. Please verify extension permissions in chrome://extensions.';
    }
    showError(friendlyMsg);
  }
}

// ─── Stop Tab Audio Capture ────────────────────────────────────────────────
async function stopCapture() {
  state.isCapturing = false;
  if (vizPollTimer) {
    clearInterval(vizPollTimer);
    vizPollTimer = null;
  }
  cachedFreqData = null;

  if (isExtensionContext && state.tabId) {
    await chrome.runtime.sendMessage({
      type: 'STOP_CAPTURE',
      tabId: state.tabId
    }).catch(() => {});
  }

  scheduleSyncUI();
}

// ─── Error Helpers ─────────────────────────────────────────────────────────
function showError(msg) {
  if (!errorText || !errorBanner) return;
  errorText.textContent = msg;
  errorBanner.classList.remove('hidden');
}

function hideError() {
  if (errorBanner) errorBanner.classList.add('hidden');
}

function disableControls() {
  if (volumeSlider) volumeSlider.disabled = true;
  if (btnBoost)     btnBoost.disabled     = true;
  if (btnMute)      btnMute.disabled      = true;
  if (bassSlider)   bassSlider.disabled   = true;
  presetBtns.forEach(b => b.disabled = true);
  modeBtns.forEach(b => b.disabled = true);
}

// ─── Event Listeners ───────────────────────────────────────────────────────

// 1. Slider: Live 60fps drag with debounced storage write
if (volumeSlider) {
  volumeSlider.addEventListener('input', (e) => {
    const pct = parseInt(e.target.value, 10);
    setGain(pct / 100, false);
  });

  volumeSlider.addEventListener('change', () => {
    scheduleSaveSettings(true);
  });
}

// 2. Preset Buttons (1x, 1.5x, 2x, 3x, 4x, 6x)
presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const pct = parseInt(btn.dataset.value, 10);
    setGain(pct / 100, true);
  });
});

// 3. Sound Profile Buttons
modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    state.eqEnabled = true; // Auto-engage EQ when user clicks an EQ profile
    sendStateToBackground('SET_EQ_ENABLED', { enabled: true });
    applyEqProfile(mode, true);
  });
});

// 3.5 EQ On/Off Toggle Button
if (btnEqToggle) {
  btnEqToggle.addEventListener('click', () => {
    state.eqEnabled = !state.eqEnabled;
    scheduleSyncUI();
    sendStateToBackground('SET_EQ_ENABLED', { enabled: state.eqEnabled });
  });
}

// 4. Sub-Bass Slider
if (bassSlider) {
  bassSlider.addEventListener('input', (e) => {
    const db = parseInt(e.target.value, 10);
    if (db > 0 && !state.eqEnabled) {
      state.eqEnabled = true;
      sendStateToBackground('SET_EQ_ENABLED', { enabled: true });
    }
    applyBass(db, false);
  });
  bassSlider.addEventListener('change', () => {
    const db = parseInt(bassSlider.value, 10);
    if (db > 0 && !state.eqEnabled) {
      state.eqEnabled = true;
      sendStateToBackground('SET_EQ_ENABLED', { enabled: true });
    }
    applyBass(db, true);
  });
}

// 5. Stereo Pan Slider & Reset
if (panSlider) {
  panSlider.addEventListener('input', (e) => {
    applyPan(parseFloat(e.target.value), false);
  });
  panSlider.addEventListener('change', () => {
    applyPan(parseFloat(panSlider.value), true);
  });
}

if (btnResetPan) {
  btnResetPan.addEventListener('click', () => {
    applyPan(0, true);
  });
}

// 6. Boost / Enable Button Toggle
if (btnBoost) {
  btnBoost.addEventListener('click', async () => {
    hideError();
    if (!state.isCapturing) {
      await startCapture();
    } else {
      if (state.gain === 0) {
        await setGain(1.0, true);
      } else {
        await stopCapture();
      }
    }
  });
}

// 7. Mute Button
if (btnMute) {
  btnMute.addEventListener('click', () => {
    toggleMute();
  });
}

// 8. Reset Button (Restore Defaults)
if (btnReset) {
  btnReset.addEventListener('click', () => {
    resetVolume();
  });
}

// 9. Light / Dark Theme Button Toggle
if (btnTheme) {
  btnTheme.addEventListener('click', () => {
    toggleTheme();
  });
}

// 10. Settings Drawer Toggle
if (btnSettings && settingsPanel) {
  btnSettings.addEventListener('click', () => {
    settingsPanel.classList.remove('hidden');
    btnSettings.classList.add('active');
  });
}

if (btnCloseSettings && settingsPanel) {
  btnCloseSettings.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
    if (btnSettings) btnSettings.classList.remove('active');
  });
}

// 10.5 Smart Tools Event Listeners
if (btnChipNormalizer) {
  btnChipNormalizer.addEventListener('click', () => toggleNormalizer(true));
}
if (btnDrawerNormalizer) {
  btnDrawerNormalizer.addEventListener('click', () => toggleNormalizer(true));
}

if (btnChipDialogue) {
  btnChipDialogue.addEventListener('click', () => toggleDialogueClarity(true));
}
if (btnDrawerDialogue) {
  btnDrawerDialogue.addEventListener('click', () => toggleDialogueClarity(true));
}

if (btnChipTimer) {
  btnChipTimer.addEventListener('click', async () => {
    const steps = [0, 15, 30, 45, 60];
    const cur = state.sleepTimer?.active ? (state.sleepTimer.totalMinutes || 0) : 0;
    const nextIdx = (steps.indexOf(cur) + 1) % steps.length;
    await setSleepTimer(steps[nextIdx], true);
  });
}

if (btnQuickTimer && settingsPanel) {
  btnQuickTimer.addEventListener('click', () => {
    settingsPanel.classList.remove('hidden');
    if (btnSettings) btnSettings.classList.add('active');
  });
}

timerPresetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const minutes = parseInt(btn.dataset.minutes, 10);
    setSleepTimer(minutes, true);
  });
});

// 11. Cleanup Popup UI on Unload (Audio in Offscreen Document REMAINS ALIVE!)
window.addEventListener('unload', () => {
  if (vizPollTimer) clearInterval(vizPollTimer);
  if (vizAnimId) cancelAnimationFrame(vizAnimId);
});

// ─── Initialization ────────────────────────────────────────────────────────
async function init() {
  try {
    setupVisualizer();

    // 1. Theme Detection
    let initialTheme = 'dark';
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      initialTheme = 'light';
    }
    if (chrome?.storage?.local) {
      const storedTheme = await chrome.storage.local.get('app_theme').catch(() => null);
      if (storedTheme?.app_theme) {
        initialTheme = storedTheme.app_theme;
      }
    }
    applyTheme(initialTheme);

    // 2. Standalone preview fallback
    if (!isExtensionContext) {
      state.domain = 'youtube.com';
      state.tabId = 999;
      if (domainText) domainText.textContent = state.domain;
      startVisualizer();
      scheduleSyncUI();
      return;
    }

    // 3. Query active tab in current window
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return showError('No active tab found.');

    state.tabId = tab.id;

    // Check for chrome:// system pages
    const isSystemPage = !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:');

    if (isSystemPage) {
      state.domain = 'System Tab';
      if (domainText) domainText.textContent = tab.url ? (tab.url.split('/')[2] || 'System Page') : 'Chrome System Tab';
      if (captureStatus) {
        captureStatus.textContent = '○ Inactive';
        captureStatus.className = 'status-badge status-inactive';
      }
      showError('System page: Audio capture is restricted. Open any website playing audio to boost.');
      disableControls();
      scheduleSyncUI();
      return;
    }

    // Parse domain
    try {
      const url = new URL(tab.url);
      state.domain = url.hostname;
    } catch {
      state.domain = tab.url;
    }

    if (domainText) domainText.textContent = state.domain || tab.title || 'Active Tab';

    // Favicon
    if (tab.favIconUrl && tab.favIconUrl.startsWith('http')) {
      faviconImg.src = tab.favIconUrl;
      faviconImg.classList.remove('hidden');
      if (faviconFallback) faviconFallback.classList.add('hidden');
    }

    // Retrieve state from background worker (Offscreen Coordinator)
    const response = await chrome.runtime.sendMessage({
      type: 'GET_STATE',
      tabId: state.tabId
    }).catch(() => null);

    if (response?.state) {
      state.gain = response.state.gain ?? DEFAULT_GAIN;
      state.bass = response.state.bass ?? 0;
      state.eqMode = response.state.eqMode ?? 'balanced';
      state.eqEnabled = response.state.eqEnabled ?? false;
      state.pan = response.state.pan ?? 0;
      state.isMuted = response.state.muted ?? false;
      state.isCapturing = response.state.capturing ?? false;
      state.normalizer = response.state.normalizer ?? false;
      state.dialogueClarity = response.state.dialogueClarity ?? false;
      state.sleepTimer = response.state.sleepTimer ?? null;

      if (state.sleepTimer?.active) {
        startTimerTicker();
      }
    }

    startVisualizer();
    scheduleSyncUI();

  } catch (err) {
    console.error('[VBP Popup] Init error:', err);
    showError(`Initialization error: ${err.message}`);
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────
init();
