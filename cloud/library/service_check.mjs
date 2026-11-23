// Synthetic real-service verification CLI for the private library Worker. Run
// only after a reviewed enablement deploy; it exercises the exact production
// path with generated metadata, never personal library rows. The check logic
// lives in check_core.mjs, shared with the temporary reviewed browser staging
// fixture; this wrapper pins the origin and supplies the owner bearer token.
//
//   node cloud/library/service_check.mjs --origin https://<worker>.workers.dev \
//     --token-env LIBRARY_CHECK_TOKEN [--snapshots 1] [--parts 256] [--part-bytes 262144]
//
// The bearer token comes from the owner's own Access session and is read from
// an environment variable only. It is never printed, saved or forwarded.
import { pathToFileURL } from 'node:url';
import { runCheck, plannedWrites } from './check_core.mjs';

// Only a pinned Workers hostname: no other origin, scheme, port or path.
export function validCheckOrigin(origin) {
  return typeof origin === 'string' && /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev$/.test(origin);
}
export { plannedWrites };

export async function runServiceCheck({ origin, token, fetchImpl = fetch, snapshots = 1, parts = 256,
                                       partBytes = 256 * 1024, log = console.log, signal } = {}) {
  if (!validCheckOrigin(origin)) throw new Error('service_check: exact --origin https://<worker>.workers.dev required');
  if (typeof token !== 'string' || !token) throw new Error('service_check: bearer token missing');
  return runCheck({ baseUrl: origin, token, fetchImpl, snapshots, parts, partBytes, log, signal });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  const origin = option('--origin', ''), tokenEnv = option('--token-env', 'LIBRARY_CHECK_TOKEN');
  const token = process.env[tokenEnv];
  if (typeof token !== 'string' || !token) {
    console.error(`service_check: bearer token must be in env ${tokenEnv}; never paste it on the command line`);
    process.exit(1);
  }
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  try {
    await runServiceCheck({ origin, token, snapshots: Number(option('--snapshots', '1')),
      parts: Number(option('--parts', '256')), partBytes: Number(option('--part-bytes', String(256 * 1024))),
      signal: controller.signal });
  } catch (error) { console.error(error.message); process.exit(1); }
}
