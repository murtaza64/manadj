# Sync row-first desktop review

## Scope

- USB rows: checkbox selection, row context, compared-field chips, explicit single-file audio import staging, individual metadata choices and per-field removal.
- Hover or keyboard focus on a metadata choice previews the resulting Library value. It never stages or writes.
- The plan groups chosen fields by track. Source and destination are explicit. Review and confirmation are separate from staging; the existing backend revalidates each operation before execution.
- Column resizing transfers width between neighbours; it does not widen the track table. The Plan divider is pointer- and keyboard-resizable. Below 1000px the Plan moves below the track list.
- Acquisition remains discoverable while disconnected or after a status-read failure. Connection status is not inferred from navigation visibility.
- Engine DJ desktop and Rekordbox desktop each have independent All tracks inventory plus playlist filters. Engine desktop reads only its configured main database, not discovered removable libraries. All tracks includes unplaylisted source records.
- Desktop source identity is exact slash-normalized path only. The UI labels it Same path, never exact audio. Unmatched and ambiguous paths are excluded from the existing field review.
- Alternate-copy suggestions are display-only acquisition name/duration candidates. Conflicting explicit versions, dissimilar known artists and incompatible durations are withheld. Candidates never change import classification, fingerprints or field-write eligibility.

## Not built

Persistent cross-copy links, source-specific cue provenance selection, USB cue/grid comparison, Apply to similar, USB title writes, and a unified mixed playlist-membership plan remain under construction. A Library keep-choice does not rename the USB. The requested numbered-title destination remains unresolved, so no reverse USB write was inferred.

The existing Field review tool remains available. New desktop source review routes exact compatible selected Library IDs into that writer; it is not a new audio-identity verifier. Native Engine/Rekordbox loading and physical USB/player behaviour have not been tested.

## Evidence

- Component tests exercise selection vs expansion, mixed-selection exclusions, hover/focus preview without staging, review invalidation, exact one-track import scope and multiple staged imports after the first changes classification.
- Backend regression tests retain source-tree read-only assertions. A synthetic Engine desktop schema includes an unplaylisted track and checks the database hash is unchanged after inventory reading.
- Production frontend was run with visibly labelled synthetic API fixtures in Chrome. USB table widths checked at 1440, 1280, 1024 and 800px. Column drag, Plan divider pointer/keyboard resizing, both desktop source filters and disconnected Acquisition were exercised. No execute request was submitted in this visual run.
- This does not verify the Electron shell, real user libraries, hardware or actual Bluetooth.

Port: never for direct desktop-library database browsing/writes on Android or iOS, those databases are desktop-only. The portable row-selection/expand/plan interaction is deferred to the separately tracked mobile playlist-editor work; this desktop change makes no mobile parity claim. The existing iOS merge hold remains unchanged.
