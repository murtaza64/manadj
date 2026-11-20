# Own-device local live, work in progress

Port: now, desktop publisher and iOS listener. Android later, no native
Android listener in this slice. Existing iOS parity merge hold still applies.

This is an opt-in same-user local-network experiment. Desktop LOCAL LIVE sends
four sampled deck/mixer anchors at up to five per second to the loopback API.
The existing Phone sync LAN listener exposes read-only anchors only behind its
existing pairing middleware. It does not expose a publisher. No friends,
accounts, relay, public service, Session persistence or music upload is added.

On iOS, Settings > LISTEN TO LOCAL LIVE refreshes the Library from the selected
paired origin and takes over the phone decks after confirmation. Track IDs and
existing audio revisions must match. Audio downloads and decodes first. The
listener fetches a fresh anchor after each preparation, uses source age and a
request-midpoint estimate for position, and corrects errors over150ms by seek.
A one-second freshness watchdog pauses phone playback. Network/protocol errors,
unknown audio, loops, scratch/preview/slip, stems, FX, automation and unsupported
rates pause rather than pretend they have been replayed. Stop pauses all decks;
no command is sent back to desktop playback. Background/interruption stops.

The UI reports request RTT and the most recent pre-correction position error.
Those are diagnostics, not acoustic end-to-end latency or synchronization
proof. Source-to-server delay, asymmetric network delay, native/WebAudio DSP,
decode timing and output latency can differ. Five-Hz state anchors can miss
short gestures. This is not lossless event replay, mixed-audio streaming, or a
substitute for the full Session vocabulary. Long streamed-file pitch key lock
is refused. Master boost is refused; master/crossfader attenuation is folded
into per-channel faders using the shared taper math. Source master ceiling
versus listener ceiling can still differ.

Use only your own devices and a trusted private LAN. The existing HTTP warning
applies to credentials, audio and state. Turning on Phone sync remains explicit;
this feature does not enable a LAN listener or pair a new device itself.

Current checks are source/core/backend tests plus pending Apple CI. The Apple
fixture uses a generated WAV and synthetic anchor publisher against the real
paired listener, cache, AppModel and AVFoundation engine. Even when it passes,
it is not a real laptop playback to physical iPhone listening or clock-drift
measurement. Actual device proof and a full desktop-source integration remain
required before calling the prototype working.
