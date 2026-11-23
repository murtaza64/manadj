// Experimental local-only helper supervisor. Not registered as production IPC.
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');

class LocalSpeechSession {
  constructor({ helperPath, spawnHelper = spawn, emit, platform = process.platform, timeoutMs = 65000 }) {
    this.helperPath = helperPath;
    this.spawnHelper = spawnHelper;
    this.emit = emit;
    this.platform = platform;
    this.timeoutMs = timeoutMs;
    this.current = null;
  }
  start(locale) {
    if (this.platform !== 'darwin') throw new Error('local_speech_unsupported');
    if (!this.helperPath || typeof locale !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(locale)) throw new Error('invalid_speech_request');
    if (this.current) throw new Error('speech_busy');
    const id = randomUUID();
    const child = this.spawnHelper(this.helperPath, ['--start', locale], { shell: false, stdio: ['pipe', 'pipe', 'ignore'] });
    const state = { id, child, bytes: 0, pending: '', decoder: new StringDecoder('utf8'), timer: null, ended: false, textSeen: false, listeningSeen: false };
    this.current = state;
    const finish = (code) => {
      if (state.ended) return;
      state.ended = true;
      clearTimeout(state.timer);
      if (this.current === state) this.current = null;
      child.stdin?.destroy();
      child.kill('SIGKILL');
      this.emit({ id, type: 'end', code });
    };
    state.finish = finish;
    const fail = () => finish('invalid_helper_output');
    child.stdout.on('data', (chunk) => {
      if (state.ended) return;
      state.bytes += chunk.length;
      if (state.bytes > 64000) { fail(); return; }
      state.pending += state.decoder.write(chunk);
      let newline;
      while (!state.ended && (newline = state.pending.indexOf('\n')) !== -1) {
        const line = state.pending.slice(0, newline);
        state.pending = state.pending.slice(newline + 1);
        let value;
        try { value = JSON.parse(line); } catch { fail(); return; }
        if (!value || typeof value !== 'object' || Array.isArray(value)) { fail(); return; }
        if (value.type === 'listening' && Object.keys(value).length === 1) {
          if (!state.listeningSeen) { state.listeningSeen = true; this.emit({ id, type: 'listening' }); }
        }
        else if (value.type === 'text' && !state.textSeen && Object.keys(value).length === 2 && typeof value.text === 'string' && value.text.length <= 10000) {
          state.textSeen = true;
          const text = value.text.trim();
          if (text) this.emit({ id, type: 'text', text });
        } else if (value.type === 'end' && Object.keys(value).length === 2 && [
          'complete', 'stopped', 'timeout', 'missing_bundle_purpose', 'local_model_unavailable',
          'speech_permission_denied', 'microphone_permission_denied', 'microphone_unavailable', 'recognition_failed',
        ].includes(value.code)) finish(value.code);
        else { fail(); return; }
      }
    });
    child.on('error', () => finish('helper_unavailable'));
    child.on('exit', () => finish('helper_exited'));
    state.timer = setTimeout(() => finish('timeout'), this.timeoutMs);
    state.timer.unref?.();
    return id;
  }
  stop(id) {
    if (this.current && this.current.id === id) this.current.finish('stopped');
  }
  dispose() { this.current?.finish('stopped'); }
}
module.exports = { LocalSpeechSession };
