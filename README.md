# 🚀 Gemini Smart Navigator

**[简体中文](https://www.google.com/search?q=./readme_CN.md)** | **English**

**Gemini Smart Navigator** is an advanced UX enhancement script for Google Gemini (gemini.google.com). It generates a dynamic "mini-map" sidebar that allows you to navigate long conversations effortlessly and provides AI-powered summaries of your queries.

---

## ✨ Key Features

* **📍 Precision Navigation**: Automatically detects user queries and model responses. Click any block to **jump directly to the top** of that specific message.
* **🤖 AI-Powered Summarization**: Integrates **Zhipu AI (GLM-4-Flash)** to generate concise summaries (under 35 chars) for your questions—simply hover to preview.
* **🎨 Minimalist Aesthetic**:
* **Glassmorphism**: A sleek, frosted-glass sidebar that blends perfectly with Gemini's native UI.
* **Real-time Sync**: Uses a `MutationObserver` to detect DOM changes and update the map instantly.
* **Stable UX**: Replaced flickering hover animations with smooth brightness transitions for a more comfortable experience.


* **⚡ Performance Optimized**: Features a request queue (concurrency limit: 5) and smart history backtracking to handle extremely long chat threads.

---

## 📸 Visual Preview

> *The floating bar on the right acts as your navigation map. Blue blocks represent User queries, while Grey blocks represent Gemini's responses.*

---

## 🛠️ Installation

1. **Install Extension**: Ensure you have [Tampermonkey](https://www.tampermonkey.net/) installed in your browser.
2. **Create Script**: Click the Tampermonkey icon -> Dashboard -> Plus `+` button.
3. **Paste Code**: Copy the entire content of `Gemini_Smart_Navigator.js`, paste it into the editor, and save (`Ctrl+S`).
4. **Refresh**: Open [Gemini](https://gemini.google.com/app) and start chatting!

---

## ⚙️ Configuration (Optional AI Summary)

By default, the script shows the first 20 characters of your text. To enable **Smart AI Summaries**:

1. Get a free API Key from the [Zhipu AI Open Platform](https://open.bigmodel.cn/).
2. On the Gemini page, click the Tampermonkey icon.
3. Select **"Set Zhipu AI Token"** from the menu.
4. Paste your API Key and confirm. The page will refresh and the feature will be active.

---

## 🔧 Technical Details

| Module | Implementation |
| --- | --- |
| **Style** | Native CSS (Fixed Positioning + Backdrop-filter) |
| **Summary Engine** | GLM-4-Flash via `GM_xmlhttpRequest` |
| **Jump Logic** | `scrollIntoView` with `smooth` behavior and async history loading |
| **State Tracking** | Base64 Hash validation to prevent redundant re-renders |

---

## 📝 Changelog

### v11.0 - The Ultimate Version

* **Optimization**: Changed jump alignment to `start` (top of screen) for better readability.
* **Fix**: Removed `Scale` transformations on hover to prevent jittering/flickering in Chromium-based browsers.
* **Enhanced**: Improved the success rate of scrolling to unloaded historical messages.
