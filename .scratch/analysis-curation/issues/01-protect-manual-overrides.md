# Protect manual overrides from re-Analysis

Status: needs-triage

## Problem

Track properties (key, BPM, beatgrid) are set by Analysis, and can be manually corrected — but the system doesn't distinguish "value from Analysis" from "value a human corrected". Re-running Analysis can silently overwrite a manual correction.

## Idea

Track provenance of curated values so re-Analysis never clobbers a manual override (e.g. a per-property "manually set" flag, or treating stored Analysis results as evidence that only auto-applies when the property was never hand-edited).

## Notes

- Related structures already exist: `KeyAnalysis` / `BPMAnalysis` tables store per-method results with confidence.
- Deliberately deferred during domain-modeling (2026-07-02) as feature creep; current system makes no distinction.
