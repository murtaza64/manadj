# Neutral trim supplies summing headroom; buses end at a sample ceiling

Status: accepted

ADR 0009's `DynamicsCompressorNode` safety limiter did not establish a
ceiling. Measured with the production settings, it added 1.71 dB below its
threshold, compressed ordinary two-track mixes, and still emitted samples
up to +1.08 dBFS. Export limiting then flattened already-compressed
recordings.

Trim center is -6 dB and its 24 dB throw is -18..+6 dB. The dipless
crossfader remains unity: headroom is explicit at each channel rather than
an undocumented center dip. Master and Cue remove `DynamicsCompressorNode`
and end in a transfer-linear, -2 dBFS sample-peak ceiling. The recording tap
is post-ceiling; the file-export ceiling remains boundary defense.

Master has explicit 0 dB unity at 75% and +6 dB at maximum. Boost occurs
before the final ceiling: it can restore single-track room level after the
neutral-trim shift, but spends summing headroom rather than bypassing output
protection.

The channel meter remains post-trim/EQ/filter and pre-fader. Orange is the
target for loud passages. Its red segment is reserved for channel sample
clipping and does not mirror downstream Master ceiling activity.

## Consequences

- One channel at neutral is 6 dB quieter than the former accidental-unity
  default. This is intentional and visible in the trim policy.
- Two normal channels sum without a hidden crossfader attenuation.
- Exactly correlated channels, boost/extreme trim, and filter resonance can
  reach the final ceiling; excess is bounded rather than compressed and
  made louder.
- The live ceiling is sample-peak, not true-peak. Its 2 dB reserve reduces
  intersample/DAC risk; physical loopback remains the hardware authority.
- Historical performance-mode language calling the old compressor a
  limiter is superseded by this decision.

Measurements and source references: `docs/research/master-gain-staging.md`.
