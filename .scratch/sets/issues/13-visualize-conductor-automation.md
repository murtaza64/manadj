# 13 — Visualize Conductor automation on the performance controls

Status: needs-triage

## Parent

.scratch/sets/PRD.md

## Problem

During Conductor playback the on-screen mixer faders/EQ/filter (and MIDI
LED feedback) sit still: the Conductor writes through the Mixer's
automation overlay, which never touches base state or notifies subscribers
(ADR 0022 — deliberate, so user knob positions survive and the capture
recorder sees base state only). The Performance view therefore shows a
mix that doesn't match what's sounding. Noticed during the 04 review
click-through (2026-07-05).

## Direction (to triage)

Read-only visualization of the automation overlay on the control surfaces
while it is engaged (both the editor's MixPlayer and the Conductor benefit)
— e.g. a ghost position on MixerStrip controls, driven per-frame like the
waveform playheads, NOT via mixer notify. Must not blur the base/overlay
split: user gesture handling, capture, and persistence keep reading base
state. Touching this likely means a small read API on Mixer
(`getAutomation(channel)`) and rAF-driven ghost indicators in MixerStrip.

## Blocked by

- 04-conductor-v1 (landed Conductor; the editor case exists today)
