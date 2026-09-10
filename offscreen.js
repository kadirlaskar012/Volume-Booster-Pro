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
  balanced: { bassAdd: 0, midGain: 0, highGain: 0 },
  bass:     { bassAdd: 6, midGain: -1, highGain: 1 },
  vocal:    { bassAdd: -2, midGain: 5, highGain: 2 },
  cinema:   { bassAdd: 4, midGain: 1, highGain: 4 }
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
    pan = 0,
    muted = false
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

  // Low-shelf Sub-Bass filter (@ 140Hz)
  const bassFilter = audioCtx.createBiquadFilter();
  bassFilter.type = 'lowshelf';
  bassFilter.frequency.setValueAtTime(140, audioCtx.currentTime);

  // Peaking Mid EQ filter (@ 2.5kHz)
  const eqMidFilter = audioCtx.createBiquadFilter();
  eqMidFilter.type = 'peaking';
  eqMidFilter.frequency.setValueAtTime(2500, audioCtx.currentTime);
  eqMidFilter.Q.setValueAtTime(1.0, audioCtx.currentTime);

  // High-shelf Treble EQ filter (@ 8.0kHz)
  const eqHighFilter = audioCtx.createBiquadFilter();
  eqHighFilter.type = 'highshelf';
  eqHighFilter.frequency.setValueAtTime(8000, audioCtx.currentTime);

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

  // Intelligent Soft-Knee Safety Limiter (Prevents harsh clipping & speaker damage)
  const limiterNode = audioCtx.createDynamicsCompressor();
  limiterNode.threshold.setValueAtTime(-1.0, audioCtx.currentTime);
  limiterNode.knee.setValueAtTime(20.0, audioCtx.currentTime);
  limiterNode.ratio.setValueAtTime(12.0, audioCtx.currentTime);
  limiterNode.attack.setValueAtTime(0.003, audioCtx.currentTime);
  limiterNode.release.setValueAtTime(0.25, audioCtx.currentTime);

  // AnalyserNode for Real-time Spectrum Data
  const analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 64;
  analyserNode.smoothingTimeConstant = 0.8;

  // Destination Node to output audio
  const destNode = audioCtx.createMediaStreamDestination();

  // Connect DSP Audio Chain:
  // Source → Bass → Mid EQ → High EQ → Pan → Gain → Limiter → Analyser → Destination
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
  gainNode.connect(limiterNode);
  limiterNode.connect(analyserNode);

  // Route output to both audio destination and MediaStream destination
  limiterNode.connect(audioCtx.destination);
  limiterNode.connect(destNode);

  // Maintain active HTML Audio element to guarantee continuous stream consumption
  const audioEl = new Audio();
  audioEl.srcObject = destNode.stream;
  audioEl.volume = 1.0;
  await audioEl.play().catch(() => {});

  const pipeline = {
    tabId,
    stream,
    audioCtx,
    sourceNode,
    bassFilter,
    eqMidFilter,
    eqHighFilter,
    panNode,
    gainNode,
    limiterNode,
    analyserNode,
    destNode,
    audioEl,
    gain,
    bass,
    eqMode,
    pan,
    muted
  };

  // Apply initial EQ & Bass
  updateFilters(pipeline);

  // Listen for stream ended (tab closed or navigated)
  const audioTrack = stream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.addEventListener('ended', () => {
      stopPipeline(tabId);
      chrome.runtime.sendMessage({ type: 'TAB_CAPTURE_ENDED', tabId }).catch(() => {});
    });
  }

  pipelines.set(tabId, pipeline);
  console.log(`[VBP Offscreen] Started pipeline for tab ${tabId} with gain ${gain}x`);
  return pipeline;
}

/**
 * Update EQ filters based on preset and sub-bass intensity
 */
function updateFilters(pipeline, smooth = true) {
  const { audioCtx, bassFilter, eqMidFilter, eqHighFilter, bass, eqMode } = pipeline;
  if (!audioCtx) return;

  const preset = EQ_PRESETS[eqMode] || EQ_PRESETS.balanced;
  const timeConst = smooth ? 0.015 : 0.001;
  const targetBass = Math.min(18, Math.max(0, bass + preset.bassAdd));

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
 * Stop and clean up audio pipeline for a tab
 */
function stopPipeline(tabId) {
  if (!pipelines.has(tabId)) return;
  const p = pipelines.get(tabId);

  try {
    if (p.audioEl) {
      p.audioEl.pause();
      p.audioEl.srcObject = null;
    }
    if (p.sourceNode)   p.sourceNode.disconnect();
    if (p.bassFilter)   p.bassFilter.disconnect();
    if (p.eqMidFilter)  p.eqMidFilter.disconnect();
    if (p.eqHighFilter) p.eqHighFilter.disconnect();
    if (p.panNode)      p.panNode.disconnect();
    if (p.gainNode)     p.gainNode.disconnect();
    if (p.limiterNode)  p.limiterNode.disconnect();
    if (p.analyserNode) p.analyserNode.disconnect();
    if (p.destNode)     p.destNode.disconnect();

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
        pan: msg.pan,
        muted: msg.muted
      });
      return { success: true };
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
