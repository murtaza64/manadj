# Owner-only feedback Worker

Preparation only. Uploads default disabled. No library or raw voice endpoint.

Deployment name: `manadj-private-feedback`.
R2 binding: `FEEDBACK_BUCKET` to private bucket `manadj-private-feedback`.
Environment variables, configured by the account owner workflow:
- `TEAM_DOMAIN`: exact HTTPS Access team origin, no trailing slash.
- `POLICY_AUD`: exact audience of this Worker's dedicated owner-only Access app.
- `OWNER_EMAIL`: exact verified owner email, not a caller-provided value.
- `UPLOADS_ENABLED`: leave `false` until the deployed auth gates are checked.

Deploy `worker.bundle.mjs` as an ES module. Protect every route and preview URL
with the dedicated Cloudflare Access application, with only the owner allowed.
No service-auth policy or bypass path. Do not change unrelated Access apps.
Managed OAuth uses exact native redirect
`earth.murtaza.manadj.ios:/oauth/feedback/callback`; disable localhost and
loopback registration. The native client receives an opaque OAuth token and
presents it to Access. Access forwards a signed assertion to this Worker.
The Worker separately verifies RS256 signature, pinned issuer, audience,
expiry/nbf, subject and exact owner email before reading the report or using R2.
Never embed an Access service token, signing key or R2 key in a client.

`POST /v1/feedback` accepts JSON version 1, UUIDv4 id, title, optional description,
transcript, logs, PNG data URL screenshot. Unknown fields, voice/music fields,
non-PNG screenshots and bodies above 8 MiB are rejected. Client-side scrubbing
and destination review are still required before enabling the app upload path.
The Worker stores one immutable JSON object per report. There is no GET/list
endpoint, public URL, arbitrary object key, automatic background send or
retry-to-another-destination behavior. A successful receipt includes the report id.
A lost-response retry of the same content confirms the existing receipt using an
R2 metadata digest, without overwriting the object or extending retention. A 409
means the id exists with different or unverifiable content, never permission to
change it or clear a changed local draft. An R2 failure preserves the local draft.
The feedback bucket's 30-day lifecycle applies here only. Future music library
storage must be separate and durable with no automatic deletion.

`npm ci && npm test` runs synthetic signed-token tests. They check owner success,
other account, absent token, invalid signature, wrong audience/issuer, expiry,
future nbf, missing configuration, disabled switch, body bounds, disallowed
fields, duplicate and failed writes. These are local auth/storage-contract tests,
not proof of deployed Access policy or real-account end-to-end sign-in.

Before enabling any real report upload: verify deployed unauthenticated and
non-owner rejection, owner sign-in/session through Managed OAuth, exact audience,
private bucket/access settings and lifecycle. Use synthetic content only for
initial storage tests. Leave upload switch off until these pass and native Send
review names the cloud destination and excludes raw voice/music.

Sources:
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

Port: now, Worker contract is platform-neutral; current native client integration
is iOS. Desktop/Android uploads remain off until their own reviewed Send/auth
clients are implemented and verified. Existing local feedback is unchanged.
