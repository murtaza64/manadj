// Main-process-only, explicit-call loopback receiver. Never binds on import.
const http = require('node:http');
const { CloudFailure } = require('./policy');

function authorizeInBrowser({ attempt, openExternal, signal }) {
  if (typeof openExternal !== 'function') return Promise.reject(new CloudFailure('cloud_browser_unavailable'));
  return new Promise((resolve, reject) => {
    let complete = false, timer;
    const callback = new URL(attempt.config.redirect);
    const server = http.createServer();
    server.maxHeadersCount = 24; server.headersTimeout = 5000;
    server.requestTimeout = 5000; server.keepAliveTimeout = 1000;
    function finish(error, value) {
      if (complete) return;
      complete = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted);
      attempt.cancel(); server.close(); server.closeIdleConnections?.();
      if (error) { server.closeAllConnections?.(); reject(error); } else resolve(value);
    }
    function aborted() { finish(new CloudFailure('cloud_signin_cancelled')); }
    function answer(res, status, text, close = false) {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Connection': 'close' });
      // Only static application prose reaches the browser, never a callback value.
      res.end(text, () => { if (close) server.closeAllConnections?.(); });
    }
    server.on('request', (req, res) => {
      req.resume();
      if (complete) { answer(res, 410, 'Sign-in is no longer active.'); return; }
      if (req.headers.host !== callback.host) { answer(res, 400, 'Unexpected callback address.'); return; }
      if (req.method !== 'GET') { answer(res, 405, 'This callback accepts GET only.'); return; }
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || req.url.length > 16384) {
        answer(res, 400, 'Invalid sign-in callback.'); return;
      }
      let form;
      try { form = attempt.consume(new URL(req.url, callback.origin).href); }
      catch (error) {
        if (error.code === 'cloud_callback_rejected') { answer(res, 400, 'Sign-in callback could not be verified.'); return; }
        answer(res, 403, 'Sign-in did not finish. Return to manaDJ to try again.', true);
        // Delay failure cleanup until the static response has been handed off.
        res.once('finish', () => finish(new CloudFailure(error.code === 'cloud_signin_expired' ? 'cloud_signin_expired' : 'cloud_signin_declined')));
        return;
      }
      answer(res, 200, 'Signed in. You can return to manaDJ.', true);
      finish(null, form);
    });
    server.on('error', () => finish(new CloudFailure('cloud_callback_port_unavailable')));
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    let remaining;
    try { attempt.checkActive(); remaining = attempt.lifetimeMs - (attempt.clock() - attempt.created); }
    catch { finish(new CloudFailure('cloud_signin_expired')); return; }
    timer = setTimeout(() => finish(new CloudFailure('cloud_signin_expired')), remaining);
    timer.unref?.();
    server.listen({ host: '127.0.0.1', port: Number(callback.port), exclusive: true }, async () => {
      if (complete) { server.close(); return; }
      try {
        attempt.checkActive();
        // Exact pinned authorization URL only. No renderer-supplied URL is opened.
        await openExternal(attempt.authorizationURL());
      } catch { finish(new CloudFailure('cloud_browser_unavailable')); }
    });
  });
}
module.exports = { authorizeInBrowser };
