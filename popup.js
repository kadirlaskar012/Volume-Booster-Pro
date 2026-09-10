/**
 * popup.js — Volume Booster Pro (Ultra Edition — 60fps Butter Smooth)
 *
 * Architecture & Performance Optimization:
 * ──────────────────────────────────────────────────────────────────────────
 * - Zero Disk/IPC Choke: Audio & UI updates run at 60fps via requestAnimationFrame;
 *   storage persistence and background badge messages are debounced.
 * - Smooth Web Audio DSP: Uses setTargetAtTime() for click-free exponential smoothing.
 * - Light/Dark Theme System: Persisted in chrome.storage.local, respects prefers-color-scheme.
 * - Fixed Frame: Never resizes or overflows outside 320px x 420px.
 */

'use strict';

// ─── Constants ─────────────────────────────────────────────────────────────
const MAX_GAIN     = 6.0;  // 600%
const MIN_GAIN     = 0.0;  // 0%
const DEFAULT_GAIN = 1.0;  // 100%

// ─── Environment Detection ─────────────────────────────────────────────────
const isExtensionContext = typeof chrome !== 'undefined' && !!chrome?.tabs?.query && !!chrome?.runtime?.id;

// ─── DOM References ────────────────────────────────────────────────────────
const volumeSlider       = document.getElementById('volume-slider');
const volumeDisplay      = document.getElementById('volume-display');
const gainSubtext        = document.getElementById('gain-subtext');
const volumeHint         = document.getElementById('volume-hint');
const glowOrb            = document.getElementById('glow-orb');
const domainText         = document.getElementById('domain-text');
const faviconImg         = document.getElementById('favicon-img');
const faviconFallback    = document.getElementById('favicon-fallback');
const captureStatus      = document.getElementById('capture-status');
const boostIndicator     = document.getElementById('boost-indicator');
const boostLabel         = document.getElementById('boost-label');
const errorBanner        = document.getElementById('error-banner');
const errorText          = document.getElementById('error-text');
const btnBoost           = document.getElementById('btn-boost');
const btnBoostText       = document.getElementById('boost-btn-text');
const btnMute            = document.getElementById('btn-mute');
const btnReset           = document.getElementById('btn-reset');
const btnTheme           = document.getElementById('btn-theme');
const themeIconSun       = document.getElementById('theme-icon-sun');
const themeIconMoon      = document.getElementById('theme-icon-moon');
const btnSettings        = document.getElementById('btn-settings');
const btnCloseSettings   = document.getElementById('btn-close-settings');
const settingsPanel      = document.getElementById('settings-panel');
const presetBtns         = document.querySelectorAll('.preset-btn');
const modeBtns           = document.querySelectorAll('.mode-btn');
const activeProfileName  = document.getElementById('active-profile-name');
const bassSlider         = document.getElementById('bass-slider');
const bassDbText         = document.getElementById('bass-db-text');
const panSlider          = document.getElementById('pan-slider');
const btnResetPan        = document.getElementById('btn-reset-pan');
const popupVisualizer    = document.getElementById('popup-visualizer');

// ─── Central State Store ───────────────────────────────────────────────────
const state = {
  gain: DEFAULT_GAIN,     // 0.0 to 6.0
  isMuted: false,         // boolean
  isCapturing: false,     // boolean
  domain: '',             // active hostname
  tabId: null,            // active tab id
  bass: 0,                // Sub-bass boost: 0 to 15 dB
  eqMode: 'balanced',     // 'balanced' | 'bass' | 'vocal' | 'cinema'
  pan: 0,                 // Stereo pan: -1.0 to +1.0
  theme: 'dark'           // 'dark' | 'light'
};

// ─── Sound Profile EQ Definitions ──────────────────────────────────────────
const EQ_PRESETS = {
  balanced: { bassAdd: 0, midGain: 0, highGain: 0, label: 'Balanced', color: '#38BDF8' },
  bass:     { bassAdd: 6, midGain: -1, highGain: 1, label: 'Bass Boost', color: '#8B5CF6' },
  vocal:    { bassAdd: -2, midGain: 5, highGain: 2, label: 'Vocal Clear', color: '#10B981' },
  cinema:   { bassAdd: 4, midGain: 1, highGain: 4, label: 'Cinema 3D', color: '#EC4899' }
};

// ─── Web Audio API Hardware Node References ────────────────────────────────
let audioCtx       = null;
let sourceNode     = null;
let bassFilter     = null;  // BiquadFilter: lowshelf @ 140Hz
let eqMidFilter    = null;  // BiquadFilter: peaking @ 2.5kHz
let eqHighFilter   = null;  // BiquadFilter: highshelf @ 8.0kHz
let panNode        = null;  // StereoPannerNode (-1 to +1)
let gainNode       = null;  // GainNode
let destNode       = null;  // MediaStreamDestinationNode
let analyserNode   = null;  // AnalyserNode (fftSize 64)
let audioElement   = null;  // Output playback element
let captureStream  = null;  // MediaStream from tabCapture
let vizCtx         = null;  // Canvas 2D context
let vizAnimId      = null;  // requestAnimationFrame ID
let previewSynth   = null;  // For standalone preview mode
let cachedFreqData = null;  // Reused Uint8Array for visualizer

// ─── Debouncing & RAF Optimization Variables ───────────────────────────────
let rafSyncId      = null;
let saveDebounceId = null;

/**
 * Schedule UI update on next animation frame to prevent layout thrashing
 */
function scheduleSyncUI() {
  if (rafSyncId) return;
  rafSyncId = requestAnimationFrame(() => {
    rafSyncId = null;
    syncUI();
  });
}

/**
 * Debounce disk storage and IPC badge updates so slider moves at 60fps smoothly
 */
function scheduleSaveSettings(immediate = false) {
  if (saveDebounceId) clearTimeout(saveDebounceId);
  if (immediate) {
    saveDomainSettings();
    sendGainToBackground();
  } else {
    saveDebounceId = setTimeout(() => {
      saveDomainSettings();
      sendGainToBackground();
    }, 200);
  }
}

function sendGainToBackground() {
  if (isExtensionContext && state.tabId) {
    chrome.runtime.sendMessage({
      type: 'SET_GAIN',
      tabId: state.tabId,
      gain: state.gain
    }).catch(() => {});
  }
}

// ─── Unified UI Synchronization ────────────────────────────────────────────
function syncUI() {
  const effectiveGain = state.isMuted ? 0 : state.gain;
  const actualPct = Math.round(state.gain * 100);
  const effectivePct = Math.round(effectiveGain * 100);

  // 1. Slider value and dynamic gradient track (High Contrast)
  if (volumeSlider) {
    volumeSlider.value = actualPct;
    const fillPercentage = (actualPct / 600) * 100;
    const fillStop = actualPct >= 300 ? '#6366F1' : '#38BDF8';
    volumeSlider.style.background = `linear-gradient(to right, ${fillStop} ${fillPercentage}%, var(--slider-track) ${fillPercentage}%)`;
  }

  // 2. Big Percentage Number & Ambient Glow
  if (volumeDisplay) {
    if (state.isMuted) {
      volumeDisplay.textContent = 'MUTED';
      volumeDisplay.className = 'volume-number tier-muted';
      if (gainSubtext) gainSubtext.textContent = `${actualPct}% (sound muted)`;
      if (volumeHint) {
        volumeHint.textContent = 'Click mute button to unmute';
        volumeHint.classList.remove('hidden');
      }
    } else if (effectivePct === 0) {
      volumeDisplay.textContent = '0%';
      volumeDisplay.className = 'volume-number tier-idle';
      if (gainSubtext) gainSubtext.textContent = '0.00× (Silenced)';
      if (volumeHint) {
        volumeHint.textContent = 'Drag slider to amplify audio';
        volumeHint.classList.remove('hidden');
      }
    } else {
      volumeDisplay.textContent = `${effectivePct}%`;
      if (effectivePct === 100) {
        gainSubtext.textContent = '1.00× (Baseline)';
      } else {
        gainSubtext.textContent = `${effectiveGain.toFixed(2)}× gain`;
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

  // 3. Dynamic Glow Orb based on Volume Boost Level
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
      captureStatus.textContent = '● Enabled';
      captureStatus.classList.add('status-active');
    } else {
      captureStatus.textContent = '○ Inactive';
      captureStatus.classList.add('status-inactive');
    }
  }

  // 9. Sub-Bass Slider & Value Pill
  if (bassSlider) bassSlider.value = state.bass;
  if (bassDbText) bassDbText.textContent = `+${state.bass} dB`;

  // 10. Sound Profile Buttons
  modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === state.eqMode);
  });
  const currentPreset = EQ_PRESETS[state.eqMode] || EQ_PRESETS.balanced;
  if (activeProfileName) {
    activeProfileName.textContent = currentPreset.label;
    activeProfileName.style.color = currentPreset.color;
  }

  // 11. Stereo Pan Slider
  if (panSlider) panSlider.value = state.pan;
}

// ─── Web Audio API Parameter Application (Click-free setTargetAtTime) ───────
function applyGain() {
  if (!gainNode || !audioCtx) return;
  const factor = isExtensionContext ? 1.0 : 0.12;
  const effectiveGain = state.isMuted ? 0 : state.gain * factor;

  // W3C recommended smooth parameter transition without audio-thread clicks
  gainNode.gain.setTargetAtTime(effectiveGain, audioCtx.currentTime, 0.015);
}

function applyEqProfile(mode, smooth = true) {
  state.eqMode = mode;
  const preset = EQ_PRESETS[mode] || EQ_PRESETS.balanced;

  if (activeProfileName) {
    activeProfileName.textContent = preset.label;
    activeProfileName.style.color = preset.color;
  }

  modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  if (!audioCtx) return;
  const timeConst = smooth ? 0.03 : 0.001;

  const targetBass = Math.min(18, Math.max(0, state.bass + preset.bassAdd));
  if (bassFilter) {
    bassFilter.gain.setTargetAtTime(targetBass, audioCtx.currentTime, timeConst);
  }
  if (eqMidFilter) {
    eqMidFilter.gain.setTargetAtTime(preset.midGain, audioCtx.currentTime, timeConst);
  }
  if (eqHighFilter) {
    eqHighFilter.gain.setTargetAtTime(preset.highGain, audioCtx.currentTime, timeConst);
  }
}

function applyBass(bassValue) {
  state.bass = Math.min(15, Math.max(0, bassValue));
  if (bassDbText) bassDbText.textContent = `+${state.bass} dB`;

  if (bassFilter && audioCtx) {
    const preset = EQ_PRESETS[state.eqMode] || EQ_PRESETS.balanced;
    const targetBass = Math.min(18, Math.max(0, state.bass + preset.bassAdd));
    bassFilter.gain.setTargetAtTime(targetBass, audioCtx.currentTime, 0.015);
  }
}

function applyPan(panValue) {
  state.pan = Math.min(1.0, Math.max(-1.0, panValue));
  if (panSlider) panSlider.value = state.pan;

  if (panNode && audioCtx) {
    panNode.pan.setTargetAtTime(state.pan, audioCtx.currentTime, 0.015);
  }
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

// ─── Persistence Helper ────────────────────────────────────────────────────
async function saveDomainSettings() {
  if (!isExtensionContext || !state.domain || !chrome?.storage?.local) return;
  const key = `vol_${state.domain}`;
  const data = {
    gain: state.gain,
    bass: state.bass,
    eqMode: state.eqMode,
    pan: state.pan
  };
  await chrome.storage.local.set({ [key]: data }).catch(() => {});
}

// ─── State Mutation Handlers ───────────────────────────────────────────────
function setGain(newGain, immediateSave = false) {
  state.gain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, newGain));
  state.isMuted = false;

  applyGain();
  scheduleSyncUI();
  scheduleSaveSettings(immediateSave);
}

async function toggleMute() {
  state.isMuted = !state.isMuted;

  applyGain();
  scheduleSyncUI();

  if (isExtensionContext && state.tabId) {
    await chrome.runtime.sendMessage({
      type: 'SET_MUTED',
      tabId: state.tabId,
      muted: state.isMuted
    }).catch(() => {});
  }
}

async function resetVolume() {
  state.gain = DEFAULT_GAIN;
  state.isMuted = false;
  state.bass = 0;
  state.eqMode = 'balanced';
  state.pan = 0;

  applyGain();
  applyEqProfile('balanced');
  applyBass(0);
  applyPan(0);
  scheduleSyncUI();
  hideError();
  scheduleSaveSettings(true);

  if (isExtensionContext && state.tabId) {
    await chrome.runtime.sendMessage({
      type: 'RESET',
      tabId: state.tabId
    }).catch(() => {});
  }
}

// ─── Live Popup Spectrum Visualizer Canvas (Lightweight & Smooth) ──────────
function setupVisualizer() {
  if (!popupVisualizer) return;
  const dpr = window.devicePixelRatio || 1;
  const rectWidth = 280; // Fixed canvas logical width
  const rectHeight = 16; // Fixed canvas logical height
  popupVisualizer.width = rectWidth * dpr;
  popupVisualizer.height = rectHeight * dpr;
  vizCtx = popupVisualizer.getContext('2d');
  vizCtx.scale(dpr, dpr);
}

function startVisualizer() {
  if (vizAnimId) cancelAnimationFrame(vizAnimId);
  setupVisualizer();
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

  let hasAudio = false;
  if (analyserNode && state.isCapturing && !state.isMuted) {
    if (!cachedFreqData || cachedFreqData.length !== analyserNode.frequencyBinCount) {
      cachedFreqData = new Uint8Array(analyserNode.frequencyBinCount);
    }
    analyserNode.getByteFrequencyData(cachedFreqData);
    hasAudio = true;
  }

  const effectiveGain = state.isMuted ? 0 : state.gain;
  const actualPct = Math.round(effectiveGain * 100);

  // Dynamic bar colors based on boost tier
  let gradColor1 = '#06B6D4';
  let gradColor2 = '#38BDF8';
  if (actualPct >= 400) {
    gradColor1 = '#F59E0B';
    gradColor2 = '#EF4444';
  } else if (actualPct > 150) {
    gradColor1 = '#8B5CF6';
    gradColor2 = '#C084FC';
  }

  for (let i = 0; i < numBars; i++) {
    let barHeight = 2; // Baseline dot

    if (hasAudio && cachedFreqData) {
      const binIdx = Math.min(cachedFreqData.length - 1, Math.floor(i * (cachedFreqData.length / numBars)));
      const rawAmp = cachedFreqData[binIdx] / 255;
      const boostMultiplier = 0.5 + 0.5 * (effectiveGain / 6.0);
      barHeight = Math.max(2, rawAmp * (height - 2) * boostMultiplier);
    } else if (state.isCapturing && !state.isMuted) {
      // Gentle idle wave
      const time = Date.now() * 0.003;
      barHeight = 2 + Math.sin(time + i * 0.4) * 1.5;
    }

    const x = i * (barWidth + barGap);
    const y = height - barHeight;

    vizCtx.fillStyle = gradColor1;
    vizCtx.fillRect(x, y, barWidth, barHeight);
  }
}

// ─── Start Tab Audio Capture ───────────────────────────────────────────────
async function startCapture() {
  if (state.isCapturing) return;

  if (btnBoostText) btnBoostText.textContent = 'Connecting…';
  if (btnBoost) btnBoost.disabled = true;
  hideError();

  try {
    // ── Standalone Browser Demo (Preview Mode) ──
    if (!isExtensionContext) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const osc = audioCtx.createOscillator();
      const lfo = audioCtx.createOscillator();
      const lfoGain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(329.63, audioCtx.currentTime);
      lfo.frequency.setValueAtTime(3.5, audioCtx.currentTime);
      lfoGain.gain.setValueAtTime(10, audioCtx.currentTime);
      lfo.connect(osc.frequency);

      bassFilter = audioCtx.createBiquadFilter();
      bassFilter.type = 'lowshelf';
      bassFilter.frequency.setValueAtTime(140, audioCtx.currentTime);
      bassFilter.gain.setValueAtTime(state.bass, audioCtx.currentTime);

      eqMidFilter = audioCtx.createBiquadFilter();
      eqMidFilter.type = 'peaking';
      eqMidFilter.frequency.setValueAtTime(2500, audioCtx.currentTime);

      eqHighFilter = audioCtx.createBiquadFilter();
      eqHighFilter.type = 'highshelf';
      eqHighFilter.frequency.setValueAtTime(8000, audioCtx.currentTime);

      if (audioCtx.createStereoPanner) {
        panNode = audioCtx.createStereoPanner();
        panNode.pan.setValueAtTime(state.pan, audioCtx.currentTime);
      }

      gainNode = audioCtx.createGain();
      gainNode.gain.value = (state.isMuted ? 0 : state.gain) * 0.12;

      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 64;

      osc.connect(bassFilter);
      bassFilter.connect(eqMidFilter);
      eqMidFilter.connect(eqHighFilter);

      let chainEnd = eqHighFilter;
      if (panNode) {
        chainEnd.connect(panNode);
        chainEnd = panNode;
      }
      chainEnd.connect(gainNode);
      gainNode.connect(analyserNode);
      gainNode.connect(audioCtx.destination);

      lfo.start();
      osc.start();
      previewSynth = { osc, lfo };

      state.isCapturing = true;
      if (btnBoost) btnBoost.disabled = false;
      applyEqProfile(state.eqMode, false);
      startVisualizer();
      scheduleSyncUI();
      return;
    }

    // ── Real Chrome Extension Tab Capture ──
    captureStream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture(
        { audio: true, video: false },
        (stream) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!stream) {
            reject(new Error('tabCapture returned null stream. The tab may not have audio, or capture is already active.'));
            return;
          }
          resolve(stream);
        }
      );
    });

    audioCtx = new AudioContext({ sampleRate: 48000 });
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    sourceNode = audioCtx.createMediaStreamSource(captureStream);

    bassFilter = audioCtx.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.setValueAtTime(140, audioCtx.currentTime);
    bassFilter.gain.setValueAtTime(state.bass, audioCtx.currentTime);

    eqMidFilter = audioCtx.createBiquadFilter();
    eqMidFilter.type = 'peaking';
    eqMidFilter.frequency.setValueAtTime(2500, audioCtx.currentTime);
    eqMidFilter.Q.setValueAtTime(1.0, audioCtx.currentTime);

    eqHighFilter = audioCtx.createBiquadFilter();
    eqHighFilter.type = 'highshelf';
    eqHighFilter.frequency.setValueAtTime(8000, audioCtx.currentTime);

    if (audioCtx.createStereoPanner) {
      panNode = audioCtx.createStereoPanner();
      panNode.pan.setValueAtTime(state.pan, audioCtx.currentTime);
    }

    gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(state.isMuted ? 0 : state.gain, audioCtx.currentTime);

    destNode = audioCtx.createMediaStreamDestination();

    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 64;
    analyserNode.smoothingTimeConstant = 0.8;

    let lastNode = sourceNode;
    lastNode.connect(bassFilter);
    lastNode = bassFilter;
    lastNode.connect(eqMidFilter);
    lastNode = eqMidFilter;
    lastNode.connect(eqHighFilter);
    lastNode = eqHighFilter;

    if (panNode) {
      lastNode.connect(panNode);
      lastNode = panNode;
    }
    lastNode.connect(gainNode);

    gainNode.connect(destNode);
    gainNode.connect(analyserNode);

    audioElement = new Audio();
    audioElement.srcObject = destNode.stream;
    audioElement.volume = 1.0;
    await audioElement.play();

    captureStream.getAudioTracks()[0].addEventListener('ended', () => {
      stopCapture(false);
    });

    state.isCapturing = true;
    if (btnBoost) btnBoost.disabled = false;

    applyEqProfile(state.eqMode, false);
    startVisualizer();

    await chrome.runtime.sendMessage({ type: 'START_CAPTURE', tabId: state.tabId }).catch(() => {});
    scheduleSyncUI();

  } catch (err) {
    console.error('[VBP Popup] Capture failed:', err);
    state.isCapturing = false;
    if (btnBoost) btnBoost.disabled = false;
    scheduleSyncUI();

    let friendlyMsg = err.message;
    if (err.message.includes('already active') || err.message.includes('already captured')) {
      friendlyMsg = 'This tab audio is already being captured. Click "Enable Boost" again to reconnect, or reload the tab.';
    } else if (err.message.includes('permission')) {
      friendlyMsg = 'Permission denied. Please verify extension permissions in chrome://extensions.';
    } else if (err.message.includes('null stream')) {
      friendlyMsg = 'Could not capture audio. Play audio on the page first, then click Enable Boost.';
    }
    showError(friendlyMsg);
  }
}

// ─── Stop Tab Audio Capture ────────────────────────────────────────────────
async function stopCapture(userInitiated = true) {
  if (vizAnimId) {
    cancelAnimationFrame(vizAnimId);
    vizAnimId = null;
  }

  if (previewSynth) {
    try {
      previewSynth.osc.stop();
      previewSynth.lfo.stop();
      previewSynth.osc.disconnect();
      previewSynth.lfo.disconnect();
    } catch {}
    previewSynth = null;
  }

  if (audioElement) {
    audioElement.pause();
    audioElement.srcObject = null;
    audioElement = null;
  }

  if (sourceNode)   { try { sourceNode.disconnect();   } catch {} sourceNode   = null; }
  if (bassFilter)   { try { bassFilter.disconnect();   } catch {} bassFilter   = null; }
  if (eqMidFilter)  { try { eqMidFilter.disconnect();  } catch {} eqMidFilter  = null; }
  if (eqHighFilter) { try { eqHighFilter.disconnect(); } catch {} eqHighFilter = null; }
  if (panNode)      { try { panNode.disconnect();      } catch {} panNode      = null; }
  if (gainNode)     { try { gainNode.disconnect();     } catch {} gainNode     = null; }
  if (destNode)     { try { destNode.disconnect();     } catch {} destNode     = null; }
  if (analyserNode) { try { analyserNode.disconnect(); } catch {} analyserNode = null; }

  if (captureStream) {
    captureStream.getTracks().forEach(track => track.stop());
    captureStream = null;
  }

  if (audioCtx) {
    try { await audioCtx.close(); } catch {}
    audioCtx = null;
  }

  state.isCapturing = false;

  if (userInitiated && isExtensionContext && state.tabId) {
    await chrome.runtime.sendMessage({ type: 'STOP_CAPTURE', tabId: state.tabId }).catch(() => {});
  }

  if (popupVisualizer && vizCtx) {
    vizCtx.clearRect(0, 0, popupVisualizer.width, popupVisualizer.height);
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

// ─── Event Listeners (Zero-Lag Throttled) ───────────────────────────────────

// 1. Slider: Live 60fps drag without blocking IPC or disk writes
if (volumeSlider) {
  volumeSlider.addEventListener('input', (e) => {
    const pct = parseInt(e.target.value, 10);
    setGain(pct / 100, false); // false = don't block on disk write while dragging!
  });

  // When drag is released, immediately commit to storage
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
    applyEqProfile(mode, true);
    scheduleSaveSettings(true);
  });
});

// 4. Sub-Bass Slider
if (bassSlider) {
  bassSlider.addEventListener('input', (e) => {
    const db = parseInt(e.target.value, 10);
    applyBass(db);
    scheduleSaveSettings(false);
  });
  bassSlider.addEventListener('change', () => {
    scheduleSaveSettings(true);
  });
}

// 5. Stereo Pan Slider & Reset
if (panSlider) {
  panSlider.addEventListener('input', (e) => {
    const panVal = parseFloat(e.target.value);
    applyPan(panVal);
    scheduleSaveSettings(false);
  });
  panSlider.addEventListener('change', () => {
    scheduleSaveSettings(true);
  });
}

if (btnResetPan) {
  btnResetPan.addEventListener('click', () => {
    applyPan(0);
    scheduleSaveSettings(true);
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
        setGain(1.0, true);
      } else {
        await stopCapture(true);
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

// 10. Settings Drawer (Overlay — Never Expands Container)
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

// 11. Background Message Listener (Keyboard shortcuts)
if (isExtensionContext && chrome?.runtime?.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'GAIN_CHANGED' && message.tabId === state.tabId) {
      state.gain = message.gain;
      state.isMuted = message.muted;
      applyGain();
      scheduleSyncUI();
    }
  });
}

// 12. Cleanup on Unload
window.addEventListener('beforeunload', () => {
  if (captureStream) {
    captureStream.getTracks().forEach(track => track.stop());
  }
});

// ─── Initialization ────────────────────────────────────────────────────────
async function init() {
  try {
    setupVisualizer();

    // 1. Theme Detection: Saved preference -> system preference -> fallback dark
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
      showError('Chrome Security: Audio capture is restricted on chrome:// system pages. Please open a website with sound (e.g. YouTube, Netflix, Spotify) to boost audio.');
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

    // Retrieve state from background worker
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE', tabId: state.tabId }).catch(() => null);
    if (response?.state) {
      state.gain = response.state.gain ?? DEFAULT_GAIN;
      state.isMuted = response.state.muted ?? false;
      state.isCapturing = response.state.capturing ?? false;
    }

    // Retrieve saved domain settings from storage
    if (chrome.storage?.local) {
      const storageKey = `vol_${state.domain}`;
      const stored = await chrome.storage.local.get(storageKey);
      if (stored && stored[storageKey] !== undefined) {
        const val = stored[storageKey];
        if (typeof val === 'number') {
          state.gain = val;
        } else if (typeof val === 'object' && val !== null) {
          state.gain = val.gain ?? DEFAULT_GAIN;
          state.bass = val.bass ?? 0;
          state.eqMode = val.eqMode ?? 'balanced';
          state.pan = val.pan ?? 0;
        }
      }
    }

    scheduleSyncUI();

  } catch (err) {
    console.error('[VBP Popup] Init error:', err);
    showError(`Initialization error: ${err.message}`);
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────
init();
