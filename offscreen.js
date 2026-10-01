/**
 * offscreen.js — Volume Booster Pro Persistent Web Audio Host
 *
 * Architecture:
 * ──────────────────────────────────────────────────────────────────────────
 * Runs in an isolated Offscreen Document to keep the Web Audio API graph
 * active continuously. When the user closes the popup or clicks elsewhere,
 * the offscreen document stays alive, ensuring audio remains amplified
 * without interruption.
 */

'use strict';

const EQ_PRESETS = {
  balanced: { bassAdd: 0,    midGain: 0,    highGain: 0 },
  bass:     { bassAdd: 4.5,  midGain: -1.0, highGain: 1.0 },
  vocal:    { bassAdd: -1.5, midGain: 2.5,  highGain: 1.5 },
  cinema:   { bassAdd: 3.0,  midGain: -1.0, highGain: 2.5 }
};

// Map<tabId, Pipeline>
const pipelines = new Map();

/**
 * Start tab audio capture and instantiate Web Audio DSP pipeline
 */
async function startPipeline(tabId, streamId, initialConfig = {}) {
  // If pipeline already exists for this tab, stop it first
  if (pipelines.has(tabId)) {
    stopPipeline(tabId);
  }

  const {
    gain = 1.0,
    bass = 0,
    eqMode = 'balanced',
    eqEnabled = false,
    pan = 0,
    muted = false,
    normalizer = false,
    dialogueClarity = false
  } = initialConfig;

  // 1. Capture stream using streamId from tabCapture
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  // 2. Initialize AudioContext
  const audioCtx = new AudioContext({ sampleRate: 48000 });
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  // 3. Create Web Audio DSP Graph
  const sourceNode = audioCtx.createMediaStreamSource(stream);

  // Low-shelf Sub-Bass filter (@ 80Hz - clean punch, zero vocal boxiness)
  const bassFilter = audioCtx.createBiquadFilter();
  bassFilter.type = 'lowshelf';
  bassFilter.frequency.setValueAtTime(80, audioCtx.currentTime);

  // Peaking Mid EQ filter (@ 1.8kHz - smooth presence without megaphone harshness)
  const eqMidFilter = audioCtx.createBiquadFilter();
  eqMidFilter.type = 'peaking';
  eqMidFilter.frequency.setValueAtTime(1800, audioCtx.currentTime);
  eqMidFilter.Q.setValueAtTime(0.7, audioCtx.currentTime);

  // High-shelf Treble EQ filter (@ 10.0kHz - silky airy high end, zero sibilance)
  const eqHighFilter = audioCtx.createBiquadFilter();
  eqHighFilter.type = 'highshelf';
  eqHighFilter.frequency.setValueAtTime(10000, audioCtx.currentTime);

  // Dialogue Clarity Vocal Enhancement filter (@ 2.2kHz peaking, Q = 0.85)
  const dialogueFilter = audioCtx.createBiquadFilter();
  dialogueFilter.type = 'peaking';
  dialogueFilter.frequency.setValueAtTime(2200, audioCtx.currentTime);
  dialogueFilter.Q.setValueAtTime(0.85, audioCtx.currentTime);
  dialogueFilter.gain.setValueAtTime(dialogueClarity ? 6.5 : 0, audioCtx.currentTime);

  // Auto Volume Normalizer (Dynamic leveling: compresses loud spikes & boosts quiet passages)
  const normalizerNode = audioCtx.createDynamicsCompressor();
  if (normalizer) {
    normalizerNode.threshold.setValueAtTime(-24.0, audioCtx.currentTime);
    normalizerNode.knee.setValueAtTime(30.0, audioCtx.currentTime);
    normalizerNode.ratio.setValueAtTime(12.0, audioCtx.currentTime);
    normalizerNode.attack.setValueAtTime(0.003, audioCtx.currentTime);
    normalizerNode.release.setValueAtTime(0.25, audioCtx.currentTime);
  } else {
    normalizerNode.threshold.setValueAtTime(0, audioCtx.currentTime);
    normalizerNode.knee.setValueAtTime(0, audioCtx.currentTime);
    normalizerNode.ratio.setValueAtTime(1.0, audioCtx.currentTime);
    normalizerNode.attack.setValueAtTime(0.003, audioCtx.currentTime);
    normalizerNode.release.setValueAtTime(0.25, audioCtx.currentTime);
  }

  // Stereo Panner (-1 to +1)
  let panNode = null;
  if (audioCtx.createStereoPanner) {
    panNode = audioCtx.createStereoPanner();
    panNode.pan.setValueAtTime(pan, audioCtx.currentTime);
  }

  // Main Amplification GainNode (Up to 600%)
  const gainNode = audioCtx.createGain();
  const effectiveGain = muted ? 0 : gain;
  gainNode.gain.setValueAtTime(effectiveGain, audioCtx.currentTime);

  // Studio Soft-Knee Safety Limiter (Transparent, prevents clipping without pumping)
  const limiterNode = audioCtx.createDynamicsCompressor();
  limiterNode.threshold.setValueAtTime(-0.5, audioCtx.currentTime);
  limiterNode.knee.setValueAtTime(25.0, audioCtx.currentTime);
  limiterNode.ratio.setValueAtTime(10.0, audioCtx.currentTime);
  limiterNode.attack.setValueAtTime(0.004, audioCtx.currentTime);
  limiterNode.release.setValueAtTime(0.12, audioCtx.currentTime);

  // AnalyserNode for Real-time Spectrum Data
  const analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 64;
  analyserNode.smoothingTimeConstant = 0.8;

  // Destination Node to output audio
  const destNode = audioCtx.createMediaStreamDestination();

  // Connect DSP Audio Chain:
  // Source → Bass → Mid EQ → High EQ → Dialogue → Normalizer → Pan → Gain → Limiter → Analyser → Destination
  let lastNode = sourceNode;
  lastNode.connect(bassFilter);
  lastNode = bassFilter;
  lastNode.connect(eqMidFilter);
  lastNode = eqMidFilter;
  lastNode.connect(eqHighFilter);
  lastNode = eqHighFilter;
  lastNode.connect(dialogueFilter);
  lastNode = dialogueFilter;
  lastNode.connect(normalizerNode);
  lastNode = normalizerNode;

  if (panNode) {
    lastNode.connect(panNode);
    lastNode = panNode;
  }
  lastNode.connect(gainNode);
  gainNode.connect(limiterNode);
  limiterNode.connect(analyserNode);

  // Primary Output: Route directly to hardware speakers
  limiterNode.connect(audioCtx.destination);

  // MediaStream keep-alive: MUST be muted to prevent double playback / comb filter phasing
  limiterNode.connect(destNode);
  const audioEl = new Audio();
  audioEl.srcObject = destNode.stream;
  audioEl.muted = true;
  await audioEl.play().catch(() => {});

  const pipeline = {
    tabId,
    stream,
    audioCtx,
    sourceNode,
    bassFilter,
    eqMidFilter,
    eqHighFilter,
    dialogueFilter,
    normalizerNode,
    panNode,
    gainNode,
    limiterNode,
    analyserNode,
    destNode,
    audioEl,
    gain,
    bass,
    eqMode,
    eqEnabled,
    normalizer,
    dialogueClarity,
    pan,
    muted,
    sleepTimer: null,
    sleepTimerInterval: null,
    sleepTimerFadeTimeout: null,
    isFadingOut: false
  };

  // Apply initial EQ & Bass (respects eqEnabled)
  updateFilters(pipeline, false);

  // Listen for stream ended (tab closed or navigated)
  const audioTrack = stream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.addEventListener('ended', () => {
      stopPipeline(tabId);
      chrome.runtime.sendMessage({ type: 'TAB_CAPTURE_ENDED', tabId }).catch(() => {});
    });
  }

  pipelines.set(tabId, pipeline);
  console.log(`[VBP Offscreen] Started pipeline for tab ${tabId} (Gain: ${gain}x, EQ Enabled: ${eqEnabled})`);
  return pipeline;
}

/**
 * Update EQ filters based on preset, sub-bass intensity, and eqEnabled switch
 */
function updateFilters(pipeline, smooth = true) {
  const { audioCtx, bassFilter, eqMidFilter, eqHighFilter, bass, eqMode, eqEnabled } = pipeline;
  if (!audioCtx) return;

  const timeConst = smooth ? 0.015 : 0.001;

  if (!eqEnabled) {
    // Transparent 0 dB bypass when EQ is switched off
    if (bassFilter)   bassFilter.gain.setTargetAtTime(0, audioCtx.currentTime, timeConst);
    if (eqMidFilter)  eqMidFilter.gain.setTargetAtTime(0, audioCtx.currentTime, timeConst);
    if (eqHighFilter) eqHighFilter.gain.setTargetAtTime(0, audioCtx.currentTime, timeConst);
    return;
  }

  const preset = EQ_PRESETS[eqMode] || EQ_PRESETS.balanced;
  const targetBass = Math.min(14, Math.max(0, bass + preset.bassAdd));

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

/**
 * Update Auto Volume Normalizer compressor state
 */
function updateNormalizer(pipeline) {
  const { audioCtx, normalizerNode, normalizer } = pipeline;
  if (!audioCtx || !normalizerNode) return;
  const now = audioCtx.currentTime;
  if (normalizer) {
    normalizerNode.threshold.setTargetAtTime(-24.0, now, 0.02);
    normalizerNode.knee.setTargetAtTime(30.0, now, 0.02);
    normalizerNode.ratio.setTargetAtTime(12.0, now, 0.02);
    normalizerNode.attack.setTargetAtTime(0.003, now, 0.02);
    normalizerNode.release.setTargetAtTime(0.25, now, 0.02);
  } else {
    // Transparent bypass
    normalizerNode.threshold.setTargetAtTime(0.0, now, 0.02);
    normalizerNode.knee.setTargetAtTime(0.0, now, 0.02);
    normalizerNode.ratio.setTargetAtTime(1.0, now, 0.02);
    normalizerNode.attack.setTargetAtTime(0.003, now, 0.02);
    normalizerNode.release.setTargetAtTime(0.25, now, 0.02);
  }
}

/**
 * Update Dialogue Clarity filter state
 */
function updateDialogueClarity(pipeline) {
  const { audioCtx, dialogueFilter, dialogueClarity } = pipeline;
  if (!audioCtx || !dialogueFilter) return;
  const now = audioCtx.currentTime;
  dialogueFilter.gain.setTargetAtTime(dialogueClarity ? 6.5 : 0, now, 0.02);
}

/**
 * Sleep Timer management with smooth fade-out
 */
function setSleepTimer(pipeline, minutes) {
  if (pipeline.sleepTimerInterval) {
    clearInterval(pipeline.sleepTimerInterval);
    pipeline.sleepTimerInterval = null;
  }
  if (pipeline.sleepTimerFadeTimeout) {
    clearTimeout(pipeline.sleepTimerFadeTimeout);
    pipeline.sleepTimerFadeTimeout = null;
  }

  if (!minutes || minutes <= 0) {
    pipeline.sleepTimer = null;
    if (pipeline.isFadingOut && pipeline.gainNode && pipeline.audioCtx) {
      const eff = pipeline.muted ? 0 : pipeline.gain;
      pipeline.gainNode.gain.setTargetAtTime(eff, pipeline.audioCtx.currentTime, 0.1);
      pipeline.isFadingOut = false;
    }
    return { active: false, remainingSec: 0, totalMinutes: 0 };
  }

  const durationMs = minutes * 60 * 1000;
  const endTime = Date.now() + durationMs;
  pipeline.sleepTimer = {
    totalMinutes: minutes,
    endTime,
    durationMs
  };
  pipeline.isFadingOut = false;

  // Trigger gentle fade-out during final 60 seconds (or half if duration < 60s)
  const fadeStartBeforeEndMs = Math.min(60000, durationMs / 2);
  const fadeDelayMs = Math.max(0, durationMs - fadeStartBeforeEndMs);

  pipeline.sleepTimerFadeTimeout = setTimeout(() => {
    if (pipeline.sleepTimer && pipeline.gainNode && pipeline.audioCtx) {
      pipeline.isFadingOut = true;
      const fadeDurationSec = fadeStartBeforeEndMs / 1000;
      pipeline.gainNode.gain.setTargetAtTime(0, pipeline.audioCtx.currentTime, fadeDurationSec / 3);
    }
  }, fadeDelayMs);

  // Monitor interval to trigger exact expiration
  pipeline.sleepTimerInterval = setInterval(() => {
    if (!pipeline.sleepTimer) {
      clearInterval(pipeline.sleepTimerInterval);
      return;
    }
    const remainingMs = pipeline.sleepTimer.endTime - Date.now();
    if (remainingMs <= 0) {
      clearInterval(pipeline.sleepTimerInterval);
      pipeline.sleepTimerInterval = null;
      pipeline.sleepTimer = null;
      pipeline.isFadingOut = false;
      const tabId = pipeline.tabId;
      stopPipeline(tabId);
      chrome.runtime.sendMessage({
        type: 'TAB_TIMER_EXPIRED',
        tabId
      }).catch(() => {});
    }
  }, 1000);

  return {
    active: true,
    remainingSec: Math.round(durationMs / 1000),
    totalMinutes: minutes
  };
}

function getSleepTimerStatus(pipeline) {
  if (!pipeline || !pipeline.sleepTimer) {
    return { active: false, remainingSec: 0, totalMinutes: 0 };
  }
  const remainingMs = Math.max(0, pipeline.sleepTimer.endTime - Date.now());
  return {
    active: remainingMs > 0,
    remainingSec: Math.round(remainingMs / 1000),
    totalMinutes: pipeline.sleepTimer.totalMinutes
  };
}

/**
 * Stop and clean up audio pipeline for a tab
 */
function stopPipeline(tabId) {
  if (!pipelines.has(tabId)) return;
  const p = pipelines.get(tabId);

  try {
    if (p.sleepTimerInterval) {
      clearInterval(p.sleepTimerInterval);
      p.sleepTimerInterval = null;
    }
    if (p.sleepTimerFadeTimeout) {
      clearTimeout(p.sleepTimerFadeTimeout);
      p.sleepTimerFadeTimeout = null;
    }
    p.sleepTimer = null;

    if (p.audioEl) {
      p.audioEl.pause();
      p.audioEl.srcObject = null;
    }
    if (p.sourceNode)      p.sourceNode.disconnect();
    if (p.bassFilter)      p.bassFilter.disconnect();
    if (p.eqMidFilter)     p.eqMidFilter.disconnect();
    if (p.eqHighFilter)    p.eqHighFilter.disconnect();
    if (p.dialogueFilter)  p.dialogueFilter.disconnect();
    if (p.normalizerNode)  p.normalizerNode.disconnect();
    if (p.panNode)         p.panNode.disconnect();
    if (p.gainNode)        p.gainNode.disconnect();
    if (p.limiterNode)     p.limiterNode.disconnect();
    if (p.analyserNode)    p.analyserNode.disconnect();
    if (p.destNode)        p.destNode.disconnect();

    if (p.stream) {
      p.stream.getTracks().forEach(track => track.stop());
    }

    if (p.audioCtx) {
      p.audioCtx.close().catch(() => {});
    }
  } catch (err) {
    console.warn('[VBP Offscreen] Cleanup warning:', err);
  }

  pipelines.delete(tabId);
  console.log(`[VBP Offscreen] Stopped pipeline for tab ${tabId}`);
}

// ─── Message Dispatcher ───────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  handleOffscreenMessage(message).then(sendResponse).catch((err) => {
    console.error('[VBP Offscreen] Error:', err);
    sendResponse({ error: err.message });
  });

  return true; // Keep async channel open
});

async function handleOffscreenMessage(msg) {
  const { type, tabId } = msg;

  switch (type) {
    case 'START_CAPTURE': {
      await startPipeline(tabId, msg.streamId, {
        gain: msg.gain,
        bass: msg.bass,
        eqMode: msg.eqMode,
        eqEnabled: !!msg.eqEnabled,
        pan: msg.pan,
        muted: msg.muted,
        normalizer: !!msg.normalizer,
        dialogueClarity: !!msg.dialogueClarity
      });
      return { success: true };
    }

    case 'SET_EQ_ENABLED': {
      if (!pipelines.has(tabId)) return { success: false };
      const p = pipelines.get(tabId);
      p.eqEnabled = !!msg.enabled;
      updateFilters(p, true);
      return { success: true, eqEnabled: p.eqEnabled };
    }

    case 'SET_GAIN': {
      if (!pipelines.has(tabId)) return { success: false, notCapturing: true };
      const p = pipelines.get(tabId);
      p.gain = msg.gain;
      p.muted = false;
      const eff = p.muted ? 0 : p.gain;
      p.gainNode.gain.setTargetAtTime(eff, p.audioCtx.currentTime, 0.015);
      return { success: true, gain: p.gain };
    }

    case 'SET_BASS': {
      if (!pipelines.has(tabId)) return { success: false };
      const p = pipelines.get(tabId);
      p.bass = msg.bass;
      updateFilters(p, true);
      return { success: true };
    }

    case 'SET_EQ_PROFILE': {
      if (!pipelines.has(tabId)) return { success: false };
      const p = pipelines.get(tabId);
      p.eqMode = msg.eqMode;
      updateFilters(p, true);
      return { success: true };
    }

    case 'SET_NORMALIZER': {
      if (!pipelines.has(tabId)) return { success: false };
      const p = pipelines.get(tabId);
      p.normalizer = !!msg.enabled;
      updateNormalizer(p);
      return { success: true, normalizer: p.normalizer };
    }

    case 'SET_DIALOGUE_CLARITY': {
      if (!pipelines.has(tabId)) return { success: false };
      const p = pipelines.get(tabId);
      p.dialogueClarity = !!msg.enabled;
      updateDialogueClarity(p);
      return { success: true, dialogueClarity: p.dialogueClarity };
    }

    case 'SET_SLEEP_TIMER': {
      if (!pipelines.has(tabId)) return { success: false, notCapturing: true };
      const p = pipelines.get(tabId);
      const timerStatus = setSleepTimer(p, msg.minutes);
      return { success: true, ...timerStatus };
    }

    case 'GET_TIMER_STATUS': {
      if (!pipelines.has(tabId)) return { active: false, remainingSec: 0, totalMinutes: 0 };
      const p = pipelines.get(tabId);
      return getSleepTimerStatus(p);
    }

    case 'SET_PAN': {
      if (!pipelines.has(tabId)) return { success: false };
      const p = pipelines.get(tabId);
      p.pan = msg.pan;
      if (p.panNode) {
        p.panNode.pan.setTargetAtTime(p.pan, p.audioCtx.currentTime, 0.015);
      }
      return { success: true };
    }

    case 'SET_MUTED': {
      if (!pipelines.has(tabId)) return { success: false };
      const p = pipelines.get(tabId);
      p.muted = msg.muted;
      const eff = p.muted ? 0 : p.gain;
      p.gainNode.gain.setTargetAtTime(eff, p.audioCtx.currentTime, 0.015);
      return { success: true };
    }

    case 'STOP_CAPTURE': {
      stopPipeline(tabId);
      return { success: true };
    }

    case 'IS_CAPTURING': {
      return { capturing: pipelines.has(tabId) };
    }

    case 'GET_METRICS': {
      if (!pipelines.has(tabId)) return { hasAudio: false, data: [] };
      const p = pipelines.get(tabId);
      const dataArray = new Uint8Array(p.analyserNode.frequencyBinCount);
      p.analyserNode.getByteFrequencyData(dataArray);
      return { hasAudio: true, data: Array.from(dataArray) };
    }

    default:
      return { error: 'Unknown offscreen message' };
  }
}
