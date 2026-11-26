// Owner-only reviewed snapshot candidate. Authentication and OS-encrypted token
// storage are still required. Continuous sync stays independently disabled.
module.exports = Object.freeze({ enabled: true, continuousEnabled: false,
  resource: 'https://manadj-private-library.murtaza-javaid.workers.dev',
  issuer: 'https://frosty-pond-8fd5.cloudflareaccess.com',
  redirect: 'http://127.0.0.1:53682/oauth/library/callback' });
