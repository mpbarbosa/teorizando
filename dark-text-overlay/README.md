# Netflix Text Overlay

A Manifest V3 browser extension that displays custom text layers on top of Netflix streams using Shadow DOM injection.

> ⚠️ This may conflict with Netflix's Terms of Service. Use for personal/educational purposes only.

## How It Works

- A content script injects a fixed-position Shadow DOM host over the Netflix player
- Overlay layers are stored in `chrome.storage.sync` and survive page reloads
- The popup lets you add, remove, and configure text layers
- A visibility toggle hides/shows all layers without deleting them

## Load in Chrome (dev mode)

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder
4. Open Netflix and click the extension icon

## Load in Firefox (dev mode)

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `manifest.json`

## Project Structure

```
manifest.json
icons/
src/
  content/
    overlay.js          # Injects Shadow DOM overlay into Netflix page
  popup/
    index.html          # Extension popup UI
    popup.js            # Popup logic (add/remove layers, sync storage)
    popup.css           # Popup styles
  background/
    service-worker.js   # Routes messages from popup → content script
```

## Layer Data Shape

```js
{
  text: "Your text here",
  x: 20,         // pixels from left
  y: 20,         // pixels from top
  fontSize: 24,  // px
  color: "#ffffff"
}
```

## Next Steps

- [ ] Draggable layers (mouse events on overlay)
- [ ] Multiple named presets
- [ ] Real-time sync via WebSocket backend (Socket.io)
- [ ] Firefox Manifest V2 compatibility shim
