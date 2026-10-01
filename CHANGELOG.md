# Changelog — Volume Booster Pro

All notable changes to the **Volume Booster Pro** Chrome Extension are documented in this file.
The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (`MAJOR.MINOR.PATCH`).

---

## [v2.1.0] — 2026-10-01 (Current Release)
### 🚀 Major Feature Release: Smart Audio Suite & Night Mode Edition

#### ✨ New Features Added:
1. **🌙 Auto Volume Normalizer (Night Leveler)**:
   - Dynamic dynamic-range compression powered by Web Audio `DynamicsCompressorNode` (`threshold: -24.0 dB`, `knee: 30.0`, `ratio: 12.0`, `attack: 3ms`, `release: 250ms`).
   - Automatically dampens sudden deafening volume spikes (explosions, gunshots, loud commercials) while boosting low-level whispering dialogue.
   - 1-Click quick toggle via `#btn-chip-normalizer` on the main popup (cyan neon glow when active) and dedicated switch in the Smart Audio Studio drawer.

2. **🗣️ Dialogue Clarity (Vocal & Speech Enhancer)**:
   - Dedicated acoustic peaking `BiquadFilterNode` centered at **2,200 Hz** (`Q: 0.85`, `gain: +6.5 dB`).
   - Targets human speech formant frequencies to make dialogue crisp and intelligible in action movies, tutorials, Zoom/Google Meet calls, and podcasts without amplifying background noise.
   - 1-Click quick toggle via `#btn-chip-dialogue` on the main popup (purple neon glow when active) and dedicated switch in the drawer.

3. **⏰ Audio Sleep Timer with Gentle Exponential Fade-Out**:
   - Presets for **15m**, **30m**, **45m**, and **60m** selectable from the main screen chip or the drawer.
   - Runs persistently in the isolated `offscreen.js` document so the timer continues accurately even if the user closes the popup.
   - **Gentle Fade-Out**: Automatically initiates a smooth exponential volume ramp down to 0% over the final 60 seconds (`gainNode.gain.setTargetAtTime(0, ...)`), avoiding abrupt cuts.
   - Dispatches `TAB_TIMER_EXPIRED` to safely terminate audio capture and reset the extension toolbar badge upon expiry.
   - Live countdown ticker displayed directly on `#btn-chip-timer` (`⏳ 29:50`) and in the top bar icon.

4. **✨ Glowing "NEW" Micro-Badges**:
   - Added pulsing gradient `NEW` tags on each smart tool chip on the main popup window.
   - Added matching inline `NEW` badges inside the Smart Audio Studio drawer for clear discoverability.

5. **🎛️ Dual-Control Smart Architecture**:
   - Quick 1-click pills directly accessible on the main popup viewport (`.smart-tools-bar`).
   - Granular controls and duration selectors housed inside the collapsible `#settings-panel` overlay drawer.

#### 🔧 Internal & Architecture Enhancements:
- Added `"alarms"` permission to `manifest.json`.
- Integrated full Web Audio DSP processing (Normalizer, Dialogue Clarity, Bass, EQ, Panner) into `preview.html` for offline testbench acoustic verification.
- Validated 0 JavaScript syntax errors across all modules (`background.js`, `offscreen.js`, `popup.js`).

---

## [v2.0.0] — 2026-09-10
### 🏗️ Major Architecture Overhaul: Offscreen Persistent Audio & Store Policy Compliance

#### 🐛 Critical Bugs Fixed:
1. **Audio Stopping When Popup Closed**:
   - *Previous Issue*: In Chrome MV3, closing the popup destroyed the popup DOM and killed the `AudioContext`.
   - *Fix*: Migrated the entire Web Audio API DSP pipeline into an isolated Chrome Offscreen Document (`offscreen.html` & `offscreen.js`). Audio now remains amplified at up to 600% indefinitely until explicitly disabled or the tab is closed.
2. **Comb Filter Phasing & Hollow Sound**:
   - *Previous Issue*: Dual audio connection to hardware destination and unmuted `<audio>` stream created a 5–15ms latency offset.
   - *Fix*: Muted the keep-alive `<audio>` element (`audioEl.muted = true`) and routed primary playback directly to `audioCtx.destination`.
3. **Preset Button Clipping & Layout Shifts**:
   - *Previous Issue*: Fixed `height: 154px` on `.volume-card` caused preset buttons (`1×, 1.5×, 2×, 3×, 4×, 6×`) to be clipped at the bottom by 11px.
   - *Fix*: Expanded `.volume-card` height to `168px`, locked fixed bounds, and prevented `#volume-hint` layout shifts.
4. **Chrome Web Store Review Policy Compliance**:
   - Removed broad `<all_urls>` host permissions; switched to safe, scoped `activeTab` and `tabCapture` permissions for fast-track store review.
   - Removed repetitive brand keyword stuffing from store descriptions and manifests to resolve Yellow Argon policy compliance.

#### ✨ Features & UI Upgrades:
- **Dedicated EQ ON/OFF Toggle Switch**: Added `#btn-eq-toggle` so Equalizer starts Bypassed (transparent 0 dB) by default instead of auto-engaging.
- **Acoustic DSP Studio Re-Tuning**:
  - Sub-Bass low-shelf retuned to **80 Hz** (clean deep bass without vocal muddiness).
  - Mid EQ peaking retuned to **1,800 Hz** (`Q: 0.7`) for natural, musical clarity.
  - Treble high-shelf retuned to **10,000 Hz** for silky air without harsh sibilance.
- **Brand New App Icon**: Glossy white/cyan megaphone squircle icon with high contrast on both dark and light browser toolbars.
- **Light & Dark Theme Engine**: Full theme switcher with persistent storage.
- **L/R Stereo Balance**: Added pan slider with 1-click center reset button.

---

## [v1.0.0] — 2026-09-08
### 🐣 Initial Prototype Release
- Basic Web Audio API amplification up to 600%.
- Volume slider and baseline 1×–6× presets.
- 4 basic EQ sound profiles (Balanced, Bass Boost, Vocal Clear, Cinema 3D).
- Sub-bass boost slider.
- Initial Chrome extension popup layout.
