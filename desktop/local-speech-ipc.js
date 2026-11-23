// Main-process-only local speech bridge. No audio crosses IPC. Disabled builds
// never spawn, prompt, or capture. Runtime paths and locale are not renderer input.
const path = require('node:path');
const { execFile } = require('node:child_process');
const { LocalSpeechSession } = require('./local-speech');
const target = require('./local-speech-target');
function registerLocalSpeechIpc({ipcMain, webContents, app, getTargetURL,
  enabled = target.enabled, platform = process.platform, sessionFactory,
  probeHelper = execFile}) {
  const helperPath = path.join(process.resourcesPath || '', 'manaDJ Speak.app', 'Contents', 'MacOS', 'manaDJ Speak');
  const locale = 'en-US';
  let disposed = false, generation = 0, current = null;
  const probes = new Set();
  const available = enabled === true && platform === 'darwin' && app.isPackaged === true;
  const guard = event => {
    if (disposed || webContents.isDestroyed() || event.sender !== webContents ||
        event.senderFrame !== webContents.mainFrame) throw new Error('local_speech_forbidden');
    const expected = new URL(getTargetURL()), actual = new URL(event.senderFrame.url), page = new URL(webContents.getURL());
    if (!['http:', 'https:'].includes(expected.protocol) || !['127.0.0.1','localhost','[::1]'].includes(expected.hostname) ||
        expected.username || expected.password || actual.origin !== expected.origin || page.origin !== expected.origin)
      throw new Error('local_speech_forbidden');
  };
  const emit = value => {
    if (disposed || webContents.isDestroyed() || value.id !== current) return;
    webContents.send('local-speech:event', value);
    if (value.type === 'end') current = null;
  };
  const session = (sessionFactory || (options => new LocalSpeechSession(options)))({helperPath, platform, emit});
  const cancel = () => { generation++; current = null; session.dispose(); for (const child of probes) child.kill(); probes.clear(); };
  const handlers = [];
  const register = (name, fn) => {
    const channel = `local-speech:${name}`; handlers.push(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      guard(event);
      if (args.length) throw new Error('local_speech_invalid_request');
      if (!available) return {available:false, code:'local_speech_not_enabled'};
      return fn(event);
    });
  };
  register('capability', async event => {
    const version = generation;
    const result = await new Promise(resolve => {
      let finished = false, child;
      child = probeHelper(helperPath, ['--probe', locale],
      {timeout:5000, maxBuffer:4096, encoding:'utf8', windowsHide:true}, (error, stdout) => {
        finished = true; probes.delete(child);
        try {
          const value = JSON.parse(stdout);
          if (!value || value.type !== 'capability' || typeof value.available !== 'boolean' ||
              !['local_supported','recognizer_unavailable','local_model_unavailable'].includes(value.code) ||
              Object.keys(value).some(k => !['type','available','code','speechPermission','microphonePermission'].includes(k)))
            throw new Error();
          resolve({available:value.available, code:value.code});
        } catch { resolve({available:false,code:'local_speech_unavailable'}); }
      });
      if (!finished && child) probes.add(child);
    });
    guard(event); if (version !== generation) return {available:false,code:'local_speech_cancelled'};
    return result;
  });
  register('start', () => { if (current) throw new Error('speech_busy'); current=session.start(locale); return {id:current}; });
  register('stop', () => { cancel(); return {stopped:true}; });
  const navigate = (_event, _url, isInPlace, isMainFrame) => {if(isMainFrame === true && isInPlace === false) cancel();};
  webContents.on('did-start-navigation', navigate);
  return () => {if(disposed)return;cancel();disposed=true;handlers.forEach(c=>ipcMain.removeHandler(c));webContents.removeListener('did-start-navigation',navigate);};
}
module.exports = {registerLocalSpeechIpc};
