# Private cross-device trial, source-build handoff

This is a source candidate, not a release or a claim that private sync is ready.
The generated hosted service check passed. Personal-data transport stays off until
native owner sign-in and device acceptance pass. No music upload, session replay,
stems sync, or exact playing-position handover is in this slice.

## iPhone: usual Xcode install

Use the existing manaDJ checkout on the Mac. Keep local work and signing settings.
Do not delete the installed app or its library.

```sh
jj git fetch --remote origin --branch instinct/continuous-sync-integrated
jj new instinct/continuous-sync-integrated@origin
open ios/Manadj.xcodeproj
```

Select scheme Manadj, the connected/unlocked iPhone, and the existing Personal
Team. Keep automatic signing on, then Cmd-R. Existing bundle ID and committed
signing team are preserved. This is the user's existing Xcode route, not a
TestFlight or tap-installable IPA. The work Mac is build-only, not a sync target.

Settings > Private Cloud Test:
1. DEVICE ID creates/displays this phone's public origin and signing key. These
   two public values can be copied for group pinning, never a private key.
2. SIGN IN starts native owner authentication without needing a personal group.
   Success must say native owner sign-in verified. It checks the actual owner-only
   library resource. Cancel is a normal sign-in stop, not success.
3. START remains disabled. This source build does not enable personal-data sync.

Native refresh/cancel/resource-denial and real device convergence still need
acceptance. A hosted browser check does not establish them.

## Desktop: managed source build, not installer

Use a personal computer, not the work Mac. Select this branch in an existing
checkout, preserving local work. Standard project setup applies:

```sh
uv sync --frozen
cd frontend && npm ci && npm run build
cd ../desktop && npm ci
npx electron . --managed
```

Managed mode owns the local backend. Attach-only mode does not expose the private
ORM bridge. The continuous controls remain disabled in this candidate. No release
cut, DMG, or installer is produced by these commands.

## Local provisioning after owner/device acceptance

This is operator preparation, not a reason to enable an untested build. Stop the
app before changing local group enrollment. Use the application's normal data
root, never another database or a copied personal database in CI.

```sh
uv run -m scripts.continuous_sync_setup init
uv run -m scripts.continuous_sync_setup pin --group GROUP --origin PHONE_ORIGIN --public-key PHONE_PUBLIC_KEY
uv run -m scripts.continuous_sync_setup identify --group GROUP --track-ids SELECTED_LOCAL_IDS
```

`init` prints only a new group ID and this desktop's public origin/key. It never
replaces a group. `pin` requires explicit public values from the intended own
device and never replaces or un-revokes a pin. `identify` binds only 1..25 selected
local track IDs and establishes local capture baselines, without network calls.
Repeat explicit pinning on each personal desktop. Phone pins come from DEVICE ID.

The native public config exporter additionally requires a JSON mapping of logical
track UUIDs to the phone's actual local track IDs. Do not assume equal numeric
IDs. It hashes selected desktop audio, exports only public pins/content hashes,
and the phone independently hashes its downloaded bytes before accepting:

```sh
uv run -m scripts.continuous_sync_native_config --group GROUP --phone-origin PHONE_ORIGIN --mapping phone-map.json --output phone-group.json
```

Send/import only that public config on the intended phone. No signing seed,
bearer token, database, audio file, or private path is part of the export.
The cloud's group pins must match the same public devices and verified owner
subject before personal testing. Existing generated service-check pins are not
personal enrollment.

## Trial limits and session behavior

Up to three pinned personal devices. Foreground only. Manual start/stop, four-hour
client expiry, server-side daily 8192-request/2048-operation/16MiB ceilings.
A local process budget can stop earlier. Pending operations stay local; limits
must be shown, not silently bypassed or fitted by dropping events.

Capture can start after selected library tracks are already loaded, using their
exact engine load identities. Imported/unbound tracks are rejected. A normal
stop requests a render-thread fence, drains the final committed frame, flushes
the journal, then tries to publish final history before transport stops. An
interruption/timeout/gap remains incomplete. Only one capture epoch is supported
per app lifetime; reopen the app before another capture. FX/scratch/preview
capture are not supported and stop evidence capture rather than invent history.

Music must already be downloaded on each device. Titles/main cues and supported
session-event history are the tested scope. Conflicts retain both values; remote
history is not automatically replayed. This remains short of full music/session
handoff.
