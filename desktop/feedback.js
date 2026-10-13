// Capture only the app window, never the desktop, a child window, or an iframe.
function registerFeedbackCapture({ ipcMain, webContents, targetUrl }) {
  const channel = "feedback:capture";
  const target = new URL(targetUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  let capturing = false;

  function authorize(event) {
    if (!local || !["http:", "https:"].includes(target.protocol)
      || target.username || target.password || webContents.isDestroyed()
      || event.sender !== webContents || event.senderFrame !== webContents.mainFrame) {
      throw new Error("Screenshot capture is restricted to the local app window");
    }
    const frame = new URL(event.senderFrame.url);
    const page = new URL(webContents.getURL());
    if (frame.origin !== target.origin || page.origin !== target.origin) {
      throw new Error("App navigated away from the screenshot origin");
    }
  }

  ipcMain.handle(channel, async (event) => {
    authorize(event);
    if (capturing) throw new Error("Screenshot capture already in progress");
    capturing = true;
    try {
      const image = await webContents.capturePage();
      authorize(event);
      if (image.isEmpty()) throw new Error("App screenshot unavailable");
      const size = image.getSize();
      let scale = Math.min(1, 1600 / Math.max(size.width, size.height));
      for (let attempt = 0; attempt < 8; attempt++, scale *= 0.65) {
        const resized = image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
        });
        const data = resized.toDataURL();
        if (data.startsWith("data:image/png;base64,") && data.length < 4 * 1024 * 1024) return data;
      }
      throw new Error("App screenshot exceeds the attachment limit");
    } finally {
      capturing = false;
    }
  });
  return () => ipcMain.removeHandler(channel);
}

module.exports = { registerFeedbackCapture };
