# 🗺️ Volume Booster Pro — Feature Roadmap & Future Updates

This document tracks all planned, architected, and prioritized features for upcoming releases of **Volume Booster Pro**. These features are designed to keep the extension ahead of competitors, boost user retention, and drive 5-star ratings on the Chrome Web Store.

---

## 📌 Release Milestones Overview

| Milestone | Target Focus | Key Features |
| :--- | :--- | :--- |
| **v2.1** | Multi-Tab & Utility | Active Audio Tabs Hub, Sleep Timer with Fade-Out |
| **v2.2** | Voice & Acoustic Enhancements | Dialogue Clarity / Cinema Night Mode, Mono Downmix & Hearing Balance |
| **v2.3** | Viral & Spatial FX | Karaoke / Vocal Remover, 8D Spatial Surround Sound |
| **v2.4** | Pro Studio Suite | 10-Band Graphic Equalizer, Pitch & Speed Controller |

---

## 🚀 Detailed Feature Specifications

### 1. 📑 Multi-Tab Audio Hub (Tab Switcher & Volume Mixer)
- **User Problem:** Users playing music in Spotify/YouTube while working on another tab have to hunt through dozens of open tabs to mute or adjust volume.
- **Solution:**
  - An expandable drawer at the top of the popup displaying all Chrome tabs currently outputting audio (`audible: true`).
  - Each tab row shows: Site Favicon, Page Title, Current Volume Gain, 1-Click Mute, and a "Jump to Tab" button.
  - Per-tab independent volume sliders.
- **Web API / Architecture:**
  - `chrome.tabs.query({ audible: true })`
  - `chrome.tabs.update(tabId, { active: true })`
  - Per-tab `GainNode` pipeline already supported by our `offscreen.js` architecture!

---

### 2. ⏰ Audio Sleep Timer (Auto-Off with Smooth Fade-Out)
- **User Problem:** Users listen to Lofi, ASMR, or podcasts before sleeping and want audio to turn off automatically without running all night.
- **Solution:**
  - Quick timer presets: **15m**, **30m**, **45m**, **60m**, or **Custom**.
  - Visual countdown ring inside the popup.
  - **Gentle Fade-Out:** During the final 2 minutes, volume gradually ramps down to 0% using `gainNode.gain.exponentialRampToValueAtTime`, preventing sudden abrupt silence that wakes users.
  - Automatically pauses video/audio playback when the timer completes.
- **Web API / Architecture:**
  - `chrome.alarms` API for background timer tracking.
  - `gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 60)` for smooth acoustic fade.

---

### 3. 🎬 Dialogue Clarity & Cinema Night Mode
- **User Problem:** In movies and TV series (Netflix, HBO, Prime), explosion and action sounds are deafeningly loud while actors' whispered dialogues are inaudible.
- **Solution:**
  - **Smart Dialogue Boost:** Applies a dedicated bandpass filter around human speech fundamentals (1.2 kHz – 3.5 kHz).
  - **Dynamic Night Compression:** Automatically attenuates sudden loud transients (gunshots, explosions) while raising low-level whispers.
- **Web API / Architecture:**
  - `BiquadFilterNode` (`peaking`, freq: 2200 Hz, Q: 1.2, gain: +5 dB).
  - Multi-stage `DynamicsCompressorNode` (threshold: -18 dB, ratio: 6:1, fast attack).

---

### 4. 🎤 Karaoke Mode & Vocal Remover
- **User Problem:** Users wanting to sing along to YouTube songs or practice karaoke need instrumental versions of songs.
- **Solution:**
  - 1-Click "Karaoke" toggle in the DSP effects panel.
  - Cancels center-panned lead vocal tracks while preserving stereo acoustic guitars, drums, synths, and bass.
- **Web API / Architecture:**
  - Center-channel phase cancellation via Web Audio `ChannelSplitterNode` and `ChannelMergerNode`:
  - `L_out = L - R` and `R_out = R - L` (or subtractive center band filtering 250Hz - 4kHz).

---

### 5. 🎧 8D Spatial Audio & Binaural Reverb
- **User Problem:** Stereo headphone audio feels flat and trapped inside the listener's head.
- **Solution:**
  - **8D Audio Mode:** Smooth, rhythmic circular audio panning (L → Center → R → Behind) that feels like the music is revolving around your head.
  - **Concert Hall / Stadium Reverb:** Recreates the acoustic ambience of a live auditorium or intimate jazz club.
- **Web API / Architecture:**
  - `StereoPannerNode` modulated by an LFO (`OscillatorNode` at 0.08 Hz connected to `panNode.pan`).
  - Synthetic impulse response buffer generated algorithmically for `ConvolverNode`.

---

### 6. 👂 Mono Downmix & Hearing Aid Balance
- **User Problem:**
  - Users wearing only one wireless earbud lose all audio panned to the other channel.
  - Users with partial hearing loss in one ear experience unbalanced audio.
- **Solution:**
  - **Mono Downmix Toggle:** Blends Left and Right channels into a unified mono signal fed to both ears.
  - **Independent L/R Volume:** Separate left and right channel dB trim sliders.
- **Web API / Architecture:**
  - `ChannelSplitterNode(2)` + `GainNode` per channel + `ChannelMergerNode(2)`.

---

### 7. 🎚️ 10-Band Graphic Studio Equalizer
- **User Problem:** Audiophiles and sound enthusiasts want granular control beyond 4 presets.
- **Solution:**
  - Expandable equalizer drawer with 10 frequency bands:
    `32Hz`, `64Hz`, `125Hz`, `250Hz`, `500Hz`, `1kHz`, `2kHz`, `4kHz`, `8kHz`, `16kHz`.
  - Save, export, and import custom EQ user presets.
- **Web API / Architecture:**
  - Chain of 10 `BiquadFilterNode` filters connected in series.

---

### 8. ⚡ Pitch Shifter & Continuous Speed Control
- **User Problem:** YouTube speed steps (1.25x, 1.5x) are too coarse, and users want Nightcore / deep bass pitch shifting.
- **Solution:**
  - Fine-grain speed control (0.50x to 3.00x in 0.05x increments).
  - Independent pitch shift (-12 to +12 semitones) without changing playback speed.
- **Web API / Architecture:**
  - ScriptProcessor / AudioWorklet phase vocoder or HTMLMediaElement `playbackRate` + `preservesPitch`.

---

## 📝 Implementation Notes
- All future features must continue adhering strictly to:
  1. Offline-only CSP compliance (no remote external CDNs).
  2. Isolated Offscreen Document audio processing so popup closing never interrupts playback.
  3. Fixed 320×420 px popup window bounds (using sliding drawers / modal overlays for new features).
