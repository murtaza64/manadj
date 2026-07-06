# Reconcile stranded pre-hygiene docs heads

Status: needs-triage

Eight undescribed non-empty mutable heads survive from the shared-default-workspace era (stranded snapshot shuffles): uzxrymvt, tvksmoml, vqonpxpo, xrqulloy, rtzppqlo, voupwyxs, worrzunq, pxrzqzvy. All docs: CONTEXT.md glossary edits + issue files (native-analysis 12, linked-pairs 04). Later sessions may have re-made some edits on trunk.

For each: diff against current main; still-novel content → describe and land via fast-path; superseded → abandon. Expected outcome: zero undescribed mutable heads; `jj sit` output ≤ live lanes + parked work.
