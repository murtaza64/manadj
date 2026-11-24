import {createRemoteJWKSet,jwtVerify} from 'jose';
const integer=(x,a,b)=>Number.isInteger(x)&&x>=a&&x<=b;
const reject=(status,code)=>{throw Object.assign(new Error(code),{status,code})};
const resolvers = new Map();
export async function authorizeOwner(request, env, { keyResolver, now = Date.now() } = {}) {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER || '') ||
      !/^[a-f0-9]{64}$/.test(env.ACCESS_AUD || '') || typeof env.OWNER_EMAIL !== 'string' ||
      !/^[^\s@]+@[^\s@]+$/.test(env.OWNER_EMAIL)) reject(503, 'owner_configuration_missing');
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || token.length > 16384) reject(401, 'owner_auth_required');
  try {
    let keys = keyResolver;
    if (!keys) {
      if (!resolvers.has(env.ACCESS_ISSUER)) {
        // Endpoint is derived only from the deployed configuration, never from a token.
        resolvers.set(env.ACCESS_ISSUER, createRemoteJWKSet(new URL(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`),
          { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 900000 }));
      }
      keys = resolvers.get(env.ACCESS_ISSUER);
    }
    const { payload, protectedHeader } = await jwtVerify(token, keys, {
      issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUD, algorithms: ['RS256'],
      requiredClaims: ['iss', 'aud', 'exp', 'iat', 'nbf', 'email', 'sub', 'type'],
      currentDate: new Date(now), clockTolerance: 0,
    });
    if (protectedHeader.jku || protectedHeader.jwk || protectedHeader.x5u || protectedHeader.crit ||
        typeof protectedHeader.kid !== 'string' || !protectedHeader.kid || payload.type !== 'app' ||
        typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 256 ||
        payload.email !== env.OWNER_EMAIL || payload.common_name !== undefined ||
        !integer(payload.iat, 0, Math.floor(now / 1000)) || payload.exp <= payload.iat) throw new Error();
    return { sub: payload.sub };
  } catch { reject(401, 'owner_auth_required'); }
}
