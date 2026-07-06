"""Shootout harness for native Analysis accuracy (ADR 0024).

The scoring/corpus machinery is offline-only, but the analyzer seam
(harness.analyzer + harness.grid_candidates / harness.key_candidates) is
consumed by the app as native Analysis (Phase B). Heavy deps stay behind
candidate method bodies, never at module top-level (import-hygiene guard).
"""
