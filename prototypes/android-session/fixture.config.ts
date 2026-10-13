import { fileURLToPath } from 'node:url';
export default { test: { root: fileURLToPath(new URL('../../', import.meta.url)), include: ['prototypes/android-session/fixture.ts'], environment: 'jsdom' } };
