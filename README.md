# Volume Booster Pro 🔊

A Chrome Extension (Manifest V3) that lets you boost audio volume on any browser tab **up to 600%** using the Web Audio API.

---

## 🚀 Loading as Unpacked Extension in Chrome

### Step 1: Open Chrome Extensions
1. Open Google Chrome
2. Navigate to `chrome://extensions/` in the address bar
3. Enable **Developer mode** (toggle in the top-right corner)

### Step 2: Load the Extension
1. Click **"Load unpacked"** button (top-left)
2. Browse to and select this folder:
   ```
   [your-project-folder]/Volume Booster Pro
   ```
3. Click **"Select Folder"**

### Step 3: Verify Installation
- You should see **"Volume Booster Pro"** appear in the extensions list
- The purple speaker icon will appear in your Chrome toolbar
- If you don't see it, click the puzzle piece (Extensions) icon → pin Volume Booster Pro

### Step 4: Test It
1. Navigate to any website with audio (YouTube, Spotify Web, etc.)
2. Start playing some audio
3. Click the **Volume Booster Pro** icon in the toolbar
4. Click **"Enable Boost"** — this triggers `tabCapture.capture()` directly (required by Chrome)
5. Move the slider to 200%, 300%, etc. and hear the difference!

---

## 🎛️ Features

| Feature | Description |
|---------|-------------|
| **Volume Slider** | 0% to 600% boost range |
| **Quick Presets** | 1× / 1.5× / 2× / 3× / 4× / 6× buttons |
| **Per-Domain Memory** | Volume saved per site (e.g. youtube.com = 300%) |
| **Mute Button** | Instantly silence with one click |
| **Reset Button** | Snap back to 100% and clear saved preference |
| **Badge Display** | Shows current multiplier on toolbar icon |
| **Keyboard Shortcuts** | `Ctrl+Shift+↑` / `Ctrl+Shift+↓` to adjust ±25% |

---

## 🏗️ Technical Architecture

### File Structure
```
Volume Booster Pro/
├── manifest.json       # MV3 config, permissions, keyboard commands
├── background.js       # Service worker: state, badge, keyboard shortcuts
├── popup.html          # Popup UI (Tailwind CSS dark mode)
├── popup.js            # Web Audio API graph + tabCapture logic
├── popup.css           # Custom slider styles, animations
├── content.js          # Optional: detect page audio elements (future use)
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── generate_icons.py   # Helper: resize icon to all required sizes
```

### Web Audio API Flow

```
Tab's audio output
       │
       ▼
chrome.tabCapture.capture()
       │ (MediaStream)
       ▼
AudioContext.createMediaStreamSource(stream)
       │ (MediaStreamSourceNode)
       ▼
AudioContext.createGain()          ← gainNode.gain.value = 3.0 → 300%
       │ (GainNode)
       ▼
AudioContext.createMediaStreamDestination()
       │ (MediaStreamDestinationNode)
       ▼
new Audio(destNode.stream).play()
       │
       ▼
User's speakers 🔊
```

---

## ⚠️ Important Chrome Limitations

### 1. tabCapture Gesture Requirement
`chrome.tabCapture.capture()` **must** be called directly in response to a user interaction (button click). Chrome enforces this security requirement — the API call cannot be deferred to a setTimeout or async chain that originated elsewhere.

### 2. Popup Lifecycle = Audio Lifecycle
In Manifest V3, service workers are non-persistent and **cannot hold Web Audio API objects**. The `AudioContext` lives in the popup window. This means:
- When you **close the popup**, the volume boost **stops** (tab audio returns to normal)
- When you **reopen the popup**, click "Enable Boost" again to re-activate

**Future Upgrade Path**: Use Chrome's [Offscreen Document API](https://developer.chrome.com/docs/extensions/reference/api/offscreen) (Chrome 116+) to host the `AudioContext` persistently without a visible popup.

### 3. Restricted Pages
Volume Booster cannot capture audio on:
- `chrome://` pages (Chrome settings, extensions, etc.)
- `chrome-extension://` pages
- `about:blank` and similar special pages

### 4. "Tab already captured" Error
If you see this error, either:
- Another capture session is still active (reload the tab to clear it)
- Another extension is capturing the same tab

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+↑` | Increase volume by 25% |
| `Ctrl+Shift+↓` | Decrease volume by 25% |

To change shortcuts: `chrome://extensions/shortcuts`

---

## 🔧 Permissions Explained

| Permission | Why It's Needed |
|-----------|----------------|
| `tabCapture` | Capture a tab's audio output as a MediaStream |
| `storage` | Save per-domain volume preferences |
| `activeTab` | Access the currently active tab's URL and ID |
| `scripting` | Reserved for future content script injection |

---

## 🗺️ Roadmap (Pro Features)

- [ ] **Offscreen Document** — persistent boost that survives popup close
- [ ] **EQ Presets** — Bass Boost, Voice Clarity, Cinema mode
- [ ] **Bass Boost** — BiquadFilterNode lowshelf boost
- [ ] **Auto-profiles** — Auto-apply saved settings when you visit a domain
- [ ] **Frequency Visualizer** — Real-time audio spectrum in the popup
