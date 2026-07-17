const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', path.join(os.tmpdir(), `manadj-recording-ipc-${process.pid}`));

app.whenReady().then(() => {
  const timeout = setTimeout(() => {
    process.stderr.write('recording IPC timed out\n');
    app.exit(2);
  }, 3000);
  ipcMain.on('recording:chunk', (_event, payload) => {
    clearTimeout(timeout);
    const bytes = payload?.buffer?.byteLength ?? -1;
    process.stdout.write(`recording IPC bytes=${bytes}\n`);
    app.exit(bytes === 16 ? 0 : 1);
  });
  const window = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  const script = encodeURIComponent(`
    <script>
      window.addEventListener('DOMContentLoaded', () => {
        window.manadjRecording.write('probe', new Float32Array([1, 2, 3, 4]).buffer);
      });
    </script>
  `);
  void window.loadURL(`data:text/html,${script}`);
});
