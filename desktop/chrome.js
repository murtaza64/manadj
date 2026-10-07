// Window chrome per platform (gh#313). The app's TopBar is the titlebar on
// every platform: macOS keeps its traffic lights; Windows/Linux get native
// caption buttons via titleBarOverlay (the TopBar insets past them with the
// window-controls-overlay env() vars, TopBar.css).

const path = require("node:path");

const BAR_HEIGHT = 40; // TopBar.css .topbar height
const BAR_COLOR = "#111111"; // tokens.ts CRUST
const SYMBOL_COLOR = "#cdd6f4"; // tokens.ts TEXT
const ICON = path.join(__dirname, "..", "logo.png");

/** BrowserWindow options for the main window's chrome. */
function windowChromeOptions(platform = process.platform) {
  if (platform === "darwin") {
    return { titleBarStyle: "hidden", trafficLightPosition: { x: 16, y: 13 } };
  }
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: { color: BAR_COLOR, symbolColor: SYMBOL_COLOR, height: BAR_HEIGHT },
    icon: ICON,
  };
}

/**
 * Application menu template, or null to keep Electron's default (macOS:
 * the default menu carries Edit roles that copy/paste need there).
 * Elsewhere the default menu's accelerators would stay live under the
 * hidden title bar; keep only shell essentials. Ctrl chords the app binds
 * (Ctrl+A/S/G/H/L/;, Ctrl+Z, Ctrl+F, Ctrl+D/U) must not appear here.
 */
function menuTemplate(platform = process.platform) {
  if (platform === "darwin") return null;
  return [
    {
      label: "manaDJ",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "quit", accelerator: "Ctrl+Q" },
      ],
    },
  ];
}

module.exports = { ICON, menuTemplate, windowChromeOptions };
