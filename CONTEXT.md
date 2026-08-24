# manadj

A DJ library manager. manadj is where the library is curated — the source of truth for tracks and their metadata. Engine DJ and Rekordbox are external systems: normally downstream targets, occasionally sources for data that was edited there first.

## Language

### Library

**Library**:
The collection of tracks and their metadata curated in manadj. The single source of truth. Unqualified, "the library" always means manadj's.

**Track**:
An audio file in the library together with its curated metadata: title, artist, key, BPM, energy, tags, hot cues, and analysis results. When reconciling with external libraries, a Track is referenced by its file path.
_Avoid_: song, file

**Unprocessed track**:
A Track that has been added to the library but not yet curated: no Tags assigned, artist/title not yet cleaned up. The to-do state between Import and full library membership.

**Archived**:
A curation verdict on a Track: out of the active Library (bad rip, duplicate, didn't survive curation). An Archived Track leaves default views, discovery, and Export, but its record, file, provenance, and Source Correspondence persist — nothing is deleted, and nothing resurfaces (a Scan or Refresh never re-proposes it). Reversible.
_Avoid_: hidden (sounds like a view filter), deleted (nothing is)

**Desktop shell**:
The window manadj runs in when launched as an app rather than a browser tab. Purely presentational — it attaches to a running manadj and owns no processes or state.
_Avoid_: native app (implies a packaged distributable, which this is not)

### Curation

**Tag**:
A curated label applied to a Track. Every Tag belongs to exactly one Tag Category. Engine DJ has no tag concept, so on Export, Tags are encoded as generated Engine playlists under the "ManaDJ Tags" super-playlist.
_Avoid_: MyTag (Rekordbox's term — only use when talking about the Rekordbox boundary itself)

**Tag Category**:
A named, ordered, colored grouping of Tags (e.g. Genre, Vibe, Role).

**Tag structure**:
The Tag Categories and Tags themselves — names, colors, ordering — independent of any Track. Its downstream encodings (Engine's "ManaDJ Tags" playlist tree, Rekordbox's MyTag tree) are created automatically in service of Export, not synced as a user-facing activity.

**Tag assignment**:
Which Tags a given Track has. A per-track field, like key or energy; it can agree or diverge across manadj and external libraries.

**Genre**:
A Tag Category. A Track's genre means its Tags in this category; the ID3 genre field in the file is untrusted and not the real genre.

**Energy**:
A first-class Track attribute (1–5) expressing intensity. Not a Tag. External libraries encode it differently (e.g. Rekordbox track color, star ratings); those encodings are Sync-boundary details.

**Playlist**:
A hand-curated, ordered list of Tracks; a Track appears at most once. Curated in manadj and Exported to external libraries. Distinct from the generated playlists that encode Tags in Engine DJ, and from a Mix (which adds performance data).

**Play order**:
The hand-curated ordering of Tracks within a Playlist — part of the Playlist's identity, what Export preserves. Distinct from a view's *sort*: sorting a playlist's track table (by BPM, key, …) changes only what is displayed and never rewrites Play order. Reordering is only possible when viewing in Play order.

**Transition**:
A first-class persisted artifact: the handover between an ordered pair of Tracks — entry/exit anchors (in seconds), a duration, an optional tempo-match, drawn automation lanes for mixer controls, and Jump events on the incoming Track. Directional (A→B is not B→A); a pair usually has one Transition, occasionally several. The incoming entry anchor may be negative: the incoming Track's audio then begins partway into the Transition (a silent lead gap). Beat-snapping and tempo-matching are editing affordances, not the model. The accumulating set of saved Transitions is the library of "what mixes well into what" — the seed of track-association features.

**Sketch origin**:
The Transition editor's timeline starts at the outgoing Track's start — an invariant, not a setting. The outgoing Track never moves on the timeline; every alignment gesture is expressible as a Slide of the incoming Track, the window, or both. Holds for Cameos with host as the outgoing role — the host never slides, though it may Jump inside the window (the timeline is its elapsed play, so it runs the full width).

**Transition editor**:
The top-panel mode (a sibling of the library and Performance views) for editing the saved Transition — or Cameo, kind-aware on the same surface — between two loaded Tracks on a DAW-style timeline. Its A/B labels are role shorthand, not physical Deck identities: A is outgoing and B incoming for a Transition; A is host and B guest for a Cameo. A chosen pair of physical Decks carries those roles during an audition; the editor is not fixed to application Decks A/B, and the other Decks retain their state. Its auditions play through the shared Decks and Mixer, claiming the Audible surface on the first audition gesture, not on entry (revised 2026-07-05: a mounted editor no longer silences ongoing playback — Set playback in particular continues across mode switches until an audition starts); one audible surface at a time still holds at the moment sound starts.

**Set**:
An ordered sequence of Tracks whose adjacencies each pin, by explicit reference, a saved Transition, a Take, or an explicit Hard-cut — or pin nothing (Unresolved, which auto-resolves at plan time) — the planned form of a DJ set. Pins are stable: saving new Transitions for a pair never changes an existing pin. Auto-fill bulk-pins (freezes) the auto-resolved choices but never a Take — Takes are by definition unreviewed, so pinning one is always a deliberate act naming that evidence: per-adjacency in the pin picker, per-run when seeding a Set from a Played run (amended 2026-07-08; the doctrine's point is that no Take is pinned without the user choosing it, not that pins arrive one at a time), or per-Set via **Resolve from evidence** (2026-08-24): one previewed, confirmed gesture pinning the best Take on every Unresolved adjacency — chop-Takes flagged for review, hard-cuts listed; promoting a Take re-points every Set pin to the resulting Transition. Reordering never destroys a pin: a broken adjacency's pin goes Dormant and restores if the pair becomes adjacent again. Entries additionally carry Cameo pins — zero or more saved Cameos (or, manually, Cameo Takes) hosted by that entry's Track. Cameo pins are always manual (an ornament resolves to nothing — no Unresolved state, never auto-filled), adjacency-independent (reordering never touches them), and overlapping windows are a validation flag, not forbidden. Renames the former "Mix" concept (2026-07-05), which collided with the Classification value "mix" (an externally recorded DJ mix on a Source). Distinct from a Playlist: a Playlist's identity is hand-curated order for curation and Export; a Set's identity is its adjacencies and what they pin.
_Avoid_: mix (retired), setlist, auto playlist

**Dormant pin**:
A Set's memory of a pin whose adjacency was broken by reordering or removal — kept per ordered pair, per Set, and restored automatically when that pair becomes adjacent in that Set again (restoring a manually-pinned Take honors the original manual act). Strictly per-Set: another Set with the same pair gets auto-fill, not this Set's memory. Cameo pins go Dormant the same way — keyed on their host Track per Set — when that Track is removed, restoring if it returns. Makes reordering non-destructive — the discard warning it replaced (decided then overturned 2026-07-05) is gone.

**Set playback**:
Playing a Set end-to-end via the Conductor: a sounding role stays on its physical Deck, while each newly needed incoming or guest role takes the first free Deck in stable A→B→C→D preference. Tracks each play solo from their entry until the next pinned Transition's window, whose position on the outgoing Track's timeline is given by the Transition itself. The first Track starts at its beginning (its Main cue is a performance marker, not a set boundary — revised 2026-07-05). A Take pin plays its idealized vectorization. An adjacency without an applicable Transition — Unresolved with no evidence, or an explicit Hard-cut pin — hard-cuts: the outgoing Track plays to its end, the incoming starts at its Hot Cue 1, else the track start (revised 2026-07-05: the Main cue is inherently unstable — it moves during performance — while cue slot 1 is the conventional "first buildup", the stable entry anchor) — playback never stalls. Colliding windows resolve by Grace fade. Cameo pins play their guest on a free Deck without advancing the Set; a guest window colliding with a neighboring Transition's window or load point is a validation flag resolved by Grace-fading the guest out early — the adjacency always wins; connective tissue outranks ornament. Within a Cameo's window, mix time ≡ the host's elapsed play (host Jumps change how long the host plays; the plan simulates through them, and downstream anchors on the host's timeline resolve at the final pass). (A future practice mode may instead hand unresolved boundaries to the user, capturing a Take.)

**Grace fade**:
The Set planner's resolution of colliding handovers: when an adjacency's window opens with no free Deck, a dying occupant fades out early — truncated with a synthesized fade a tunable headroom before the new window — freeing a Deck to load. Authored windows never move; only the dying tail is forged. A collision too deep to grace (truncation would cut into the occupant's own entry) is planned as-authored and flagged instead. Part of the plan: the overview ladder, played durations, and the Conductor all reflect it.

**Overview ladder**:
The Set view's staircase minimap above the track list: each entry a clip on the mix-time axis, mirrored Deck lanes around a center line (A up, B down), titles on the outer edge, hot cues on the title side, Transition/Take window bands, hard cuts as an unmissable blade. A Cameo pin renders as a subordinate guest clip on the opposite Deck lane inside its host's span, carrying its two-edged window band — never a stair step (the staircase advances on adjacencies only). Freely pannable and zoomable (vertical wheel = zoom, as on waveforms; default framing fits the whole Set); independent of the track list except at convergence events — a seek and, under follow-playback, track changes — where both surfaces move to the playhead (decided 2026-07-05; no standing scroll invariant links them).

**Conductor**:
The automation driver that performs Set playback on the existing performance surface — allocating Decks from the free pool, loading them, starting transports, and moving Mixer controls per the pinned Transitions. Not a new Audible surface: the Decks and Mixer behave plainly, and any view showing them visualizes the Set as it plays. It has its own transport — play, pause, seek — which are Conductor controls, not takeover triggers; a seek is an evaluation of the playback plan at a mix-time instant (deck positions, lane values mid-window, tempo state), legal into the middle of a Transition and while paused. Any manual deck or mixer gesture stops the Conductor entirely — the Decks keep playing as they are and the user is mixing live (per-control takeover deferred). Conductor-driven playback is invisible to Take capture, like editor auditions; capture resumes at takeover. A Transition's lanes address the outgoing/incoming roles — a Cameo's the host/guest roles — not physical Decks: the Conductor maps roles onto available Decks, preferring A→B→C→D for each new allocation.

**Unresolved**:
A Set adjacency with nothing pinned. Resolves at plan time to the pair's best saved Transition — favorite first, else the most recently edited — and hard-cuts only when the pair has none (revised 2026-07-05 from always-hard-cut: unresolved is deliberately library-live, so saving or favoriting a Transition upgrades every unresolved adjacency for that pair, at the cost of unpinned playback changing as the library grows). Pinning freezes a choice; a Hard-cut pin forces a cut even when Transitions exist. Orthogonal to Unpracticed.

**Hard-cut pin**:
An explicit pin kind asserting "cut here, play no Transition" — the way to keep a deliberate cut now that Unresolved auto-resolves. Chosen from the same pin picker as Transitions and Takes.

**Unpracticed**:
A Set adjacency whose ordered pair has no saved Transition and no Take — these two Tracks have never been mixed, in either artifact's sense. Cameos and Cameo Takes don't count: teasing B over A is not rehearsing the A→B adjacency move. The Set's rehearsal to-do list. Orthogonal to Unresolved: an adjacency can be unresolved yet practiced, and (via a pinned Take) resolved yet never promoted.

**Pickup**:
The Conductor's inverse of takeover: adopting the current Deck state as a mix instant and resuming Set playback from it. Always an explicit gesture with automatic mapping — the control is lit exactly when the state maps cleanly onto the plan, anchored on the audibly dominant Deck (Master-bus audibility, as in Handover detection): one audible Deck within its planned span, or two audible Decks aligned with their pinned Transition or Cameo within tolerance. Unlit otherwise, showing the reason (track not in the Set; outside its planned span; misaligned blend — fade the stray Deck out and it lights; another surface holds audibility — an editor audition is mix-timeline semantics, not a performance to pick up from; stop it and it lights). Never audibly destructive: the anchor Deck is untouched; only silent Decks are reconciled; mixer and pitch converge to the plan via short ramps (the pitch ramp is a Tempo return). Picking up mid-Handover abandons the in-flight capture engagement — finishing a mix by machine forfeits the Take.

**Live re-plan**:
The Conductor's plan is live, not a snapshot: any plan-input change during Set playback (a Transition edit, a re-pin or auto-fill, a Dormant restore, a tempo change, a reorder) recomputes the plan and the ongoing run continues seamlessly in the new one — an automatic Pickup into the new plan (same anchor mapping, same never-audibly-destructive invariants, no button). The sounding window's rule: its GEOMETRY (start, duration, B-entry alignment, jumps, tempo-match) is deferred — the active window completes as it was, the new geometry applies downstream and on any later replay — while its lane VALUES apply live (swapping automation under the playhead is riding the mix, the editor's idiom). If a reorder removes the anchor's Track from the Set, the Conductor stands down takeover-style: the Decks keep sounding and the Pickup control surfaces the unresolvable state.

**Tempo policy**:
A per-Set choice governing tempo during Set playback. **Riding**: each incoming Track eases back to its native tempo between Transitions (see Tempo return). **Fixed**: the entire Set plays at the Set tempo — every Track pitched to it, Transitions rate-scaled as a whole; a pinned Transition's tempo-match flag is moot. One policy per Set; per-section tempo progression is deferred.

**Set tempo**:
The single BPM a Fixed-policy Set plays at. Explicit and editable on the Set, defaulted from the first Track's native BPM. Has no meaning under Riding.

**Tempo return**:
Under the Riding policy, the eased ramp of an incoming Track from its tempo-matched rate back to native after a Transition's window closes — the pitch-fader ride-back a DJ performs by hand. Ramp speed is a tunable heuristic, not part of the model; a ramp that cannot complete before the next window is a Set validation flag (insufficient runway), clamped faster rather than left incomplete.

**Favorite**:
A boolean on a Transition or Cameo marking a proven move — asserting both "these Tracks go well together" and "this specific move is good." The unit discovery ranks by. Distinct from a Track's Rating.
_Avoid_: like (social-app connotation).

**Preferred pair**:
Retired term (2026-07-05). "An ordered Track pair with at least one favorited Transition" is now an unnamed derived property — say it longhand. Its starred Transition-library marks remain; the stored, toggleable pair association it deliberately excluded now exists as Linked.

**Linked**:
A stored, symmetric, user-toggled assertion that two Tracks go well together — one fact per unordered pair of distinct Tracks (never self-Linked), toggleable whenever the pair is loaded together (Performance view, Transition editor). Independent of Favorite at write time: favoriting a Transition never links, unfavoriting never unlinks; discovery's effective "goes well together" set is the query-time union of Linked and pairs with a favorited Transition or Cameo. Surfaces as a symmetric library-row mark relative to each loaded Track, alongside the directional Transition-library marks. Feeds discovery (Follow mode) and future set-building.
_Avoid_: pairing, preferred pair. Note: "Link" as a Track↔external-library association is now External Correspondence.

**Known**:
The relation between two Tracks when they are Linked or a saved Transition or Cameo connects them — the top of discovery's three evidence tiers (Known > Observed > Compatible), the only one built from explicit user acts. Within the tier, strength orders favorited Transition, favorited Cameo, Linked, unfavorited Transition, unfavorited Cameo (provisional; a Transition outranks its Cameo peer because Follow's headline job is next-track candidates, and "guests well over" is one notch off "comes next well"); a pair takes its best. "Known only" is the Follow-mode filter narrowing to this tier (formerly "proven only").
_Avoid_: proven (connotes a rehearsed Transition, which a bare Link isn't)

**External Correspondence**:
Planned concept (formerly "Link", renamed 2026-07-05 to free Linked for the Track-pair assertion): a stored association between a Track and its counterpart row in a specific External library, keyed by that library's stable internal ID. The sibling of Source Correspondence — one Correspondence family: stable-ID-keyed associations between a Track and its representation in another system.

**Transition library**:
The queryable index over saved Transitions — "what mixes out of / into this Track" — surfaced as library-row marks and discovery filters. Directional, like the Transitions it indexes. Takes are not in it: only promotion adds to the library.

**Take**:
A Handover detected and captured automatically during live performance playback — playback while the shared Decks+Mixer surface is audible; Transition-editor auditions are invisible to capture, even though they play through the same Decks — or cut by hand from a Session (origin marked, otherwise identical; 2026-07-15) — a track pair plus the recorded performance, weaker than a Transition. Kind and pair are always derived from the events by the survivor rule over the enclosing engagement, never declared by the user — the Take's kind is evidence; wanting a different artifact kind is intent, expressed at review/promotion, not by relabeling. A hand-cut moment inside an engagement that has not yet settled has no verdict until it does. Takes live in the Transition history, never in the Transition library. Reviewed in the Transition editor via Vectorization; **promoting** a Take saves the vectorized (possibly tweaked) draft as an ordinary saved Transition (recording is a capture method, not a new artifact kind downstream). Idealization belongs to Vectorization (until 2026-07-05 this entry attributed it to promotion). Unpromoted Takes are audit data with two non-audit uses: a Set adjacency may pin one (deliberately — per-adjacency or per-run at Set seeding, never by auto-fill), playing its idealized vectorization without creating a Transition; and repeated Takes make an ordered pair Observed (2026-07-08). Takes from one Session share its clock and carry the engagement they were born from, so the pairwise offspring of a multi-deck engagement (a double or triple — Takes and Cameo Takes alike) are a first-class group, queryable as the full move rather than reconstructed by timestamp inference.
_Avoid_: recorded Transition (a Take is not a Transition until promoted)

**Handover**:
The detection target for Takes: audibility on the Master bus passes *finally* from the outgoing Track to the incoming — the incoming becomes audible while (or shortly after) the outgoing is, and the outgoing then stays silent. The definition applies per ordered pair: when more than two Decks are audible, one engagement emits a Take for every ordered pair that meets it (deliberately liberal — Takes are audit data; curation happens at review). A Track may hand over to itself (the same Track on two Decks — a dnb double against itself). Brief returns of the outgoing (cross-cuts — dnb teases, double drops) fold into the same Handover rather than ending or splitting it; a tease where the outgoing survives is no Handover but a Guest engagement — the Cameo's detection target, the same detector's other verdict. Zero-overlap hard cuts are Handovers. Cue-bus (PFL) audibility is invisible to detection. A Take's window is the whole engagement — the contiguous period the two Tracks trade or share audibility, ending at the outgoing's final cessation. Thresholds and settle horizons are tunable heuristics, not part of the definition.

**Cameo**:
A first-class persisted artifact: a guest Track's bounded appearance inside a host Track's play — the guest becomes audible and silent entirely within the host's play, and the host remains current. Anatomy is the Transition's, reshaped for a symmetric in-and-out: a two-edged window (entry/exit anchors in seconds of host track time), guest alignment (a silent lead gap allowed), an optional tempo-match — always guest→host, with no Tempo return (the host never left its rate) — automation lanes addressing the host/guest roles, and Jump events on both roles. Ordered (host, guest); a pair may have several Cameos, and Cameos alongside Transitions. A Track may Cameo over itself (same Track on two Decks, returning to the original). The survivor rule is the boundary with Transition: whoever remains current classifies the move — a double where the original rides on is a Cameo; a double you continue from is a Transition with a double-drop-shaped window, and its Track belongs in the Set order. A Cameo's guest never appears in the Set order.
_Avoid_: double, tease (names of moves, not artifacts — either artifact kind can carry them), interlude, overlay

**Guest engagement**:
The Cameo's detection target — the complementary verdict of the same detector that finds Handovers, applying the survivor rule at settle time: the incoming becomes audible while the outgoing is, then goes silent while the outgoing survives as current. Emits a Cameo Take (host = the survivor, guest = the visitor, window = the whole engagement). Same deliberately liberal posture as Handover; thresholds and settle horizons are tunable heuristics.

**Cameo Take**:
A Guest engagement detected and captured automatically during live performance playback (or hand-cut from a Session — the classifier's verdict decides which sibling a cut becomes) — the Cameo sibling of a Take, with the same rules throughout: lives in the Transition history, never in any library; reviewed via Vectorization; promotion saves a Cameo; a Set entry may pin one (manually, never by auto-fill); counts for nothing in discovery until promoted.

**Cameo library**:
The queryable index over saved Cameos — "what guests over this Track / what hosts this Track" — directional (host→guest) and distinct from the Transition library, whose "what mixes into what" stays Transition-only. Cameo Takes are not in it: only promotion adds.

**Routine**:
A first-class persisted artifact: a recorded passage of n-track choreography (n ≥ 3 — a 2-cast routine IS a Transition, and storing one as a Routine is forbidden) with a boundary contract: it *enters with its first cast Track playing* and *exits with its last cast Track playing*. Anatomy generalizes the Transition's: the window is anchored on the first Track's timeline (the first Track never slides — the Transition invariant, n-wide); the interior runs on a relative Routine clock measured in beats (beat-domain, via the cast Tracks' Beatgrids — so a Routine replays under any Set tempo policy, pitch re-anchored to the target rate); every other cast member carries an entry offset from Routine start, silent lead gaps allowed. Automation and events address **cast slots** — entry-ordered positional roles (slot 0 = the entry Track, slot n−1 = the exit Track; a Track may occupy two slots, as in a self-double) — never physical Decks: the Conductor allocates each slot a free Deck when its entry offset arrives (A→B→C→D preference) and frees it at exit. Max concurrent slots exceeding available Decks is a plan-time validation flag, not a property of the Routine. In a Set, a Routine pins onto the adjacency leaving its first Track and *covers* the following adjacencies: it is offerable exactly when its cast is the next n entries in Set order (chosen 2026-08-24 over decomposing recurring weaves into entries + Cameo pins + overlapping windows; Cameo pins remain the vocabulary for one-off, non-contiguous ornaments). A Routine's natural boundary is a *solo moment* — one Track audible; a returning Track's away-gap is interior, never a boundary — and two Routines may chain through a shared boundary Track (one's exit is the other's entry; their covered adjacencies are disjoint). A pinned Routine's dormancy keys on its boundary Tracks and cast membership only: interior cast entries may be reordered freely without disturbing the pin (the recorded choreography defines interior play order; interior Set order is presentational), while breaking a boundary or the membership sends it Dormant, restoring the covered adjacencies' shadowed pins. Composes at both boundaries: the upstream adjacency's window sits on the first Track's timeline as usual; the interior (including the exit Track's Jumps) determines the exit Track's position, and the downstream adjacency's window sits on the exit Track's timeline like any outgoing Track.
_Avoid_: move (superseded 2026-08-24), medley, block, n-track transition, sequence (hopelessly overloaded: Sets, runs, chunks)

**Routine Take**:
The captured sibling of a Routine: a hand-confirmed span of a Session — deck-literal, unreviewed evidence — created by confirming a miner-suggested candidate span on the Session timeline (suggestion-first: unlike Handover detection's liberal capture, no Routine Take is minted without a human act, because most weave-shaped spans are Practice reps). Lives in the Transition history like its siblings; promotion re-addresses deck→slot and beat-rebases the clock — mechanical, not idealizing; gesture-level lane Vectorization arrives with the future Routine editor — and saves a Routine. Pinnable in a Set deliberately, like a Take — and an *unconfirmed* candidate may additionally be offered in the pin picker when its cast matches the Set's next-n entries (the match is itself evidence of intent), at lowest trust.
_Avoid_: move take

**Practice rep**:
A detected return or alternation attributable to rehearsal rather than performance: backward transport motion on the returning Deck during the away-gap (re-seeking to replay a junction), or a pair-isolated alternation (only the two Tracks audible while they trade repeatedly — fader-drill reps). Excluded from style mining, Move candidate suggestion, and any evidence tier; retained in Sessions as ordinary events (the log is impartial — practice classification is a read-time verdict, and its thresholds are tunable heuristics).

**Jump event**:
A playback discontinuity inside a Transition or Cameo — a playhead jumps to a new position at a mix instant (a beat jump or hot-cue press mid-mix, e.g. doubling a buildup). May carry a repeat count: a backward Jump repeated k times recurs at its own displacement's period — which is exactly a loop, so loops need no separate Transition vocabulary. A repeat count is only coherent on a backward Jump (a forward one has no natural period). Intentional structure, unlike a Nudge. In a Transition, incoming-Track-only for now (the Sketch origin invariant keeps the outgoing Track's time ≡ mix time); outgoing-side jumps may be admitted later, which would restate that invariant — as a Cameo already does: a Cameo admits Jumps on both roles (looping a host section under the guest is core to doubles), restating the invariant as mix time ≡ the host's elapsed play — the host never slides, but may Jump.

**Vectorization**:
Converting a Take's raw capture events into a Transition draft — or a Cameo Take's into a Cameo draft (two-edged window, Jumps on both roles) — for review in the Transition editor. Idealizing, per lane: anchors and tempo-match distilled from playhead and pitch riding; crossfader and channel-fader work composed into the per-deck fader lanes; continuous control movements segmented into gesture-level plateaus, ramps, and steps (wobble erased by amplitude, not duration; unclassifiable stretches kept geometrically), with boundary values snapped to that lane's detents and boundary instants snapped to nearby beats; discrete gestures (beat jumps, hot-cue jumps) preserved as Jump events, a loop engagement collapsing to one repeated Jump event rather than k wraps. Runs when a Take is opened; promotion then saves the (possibly tweaked) result, baking it. The raw Take is the evidence and never changes; vectorization is re-runnable opinion, and its thresholds are tunable heuristics, not part of the definition.
_Avoid_: reify, conversion (too generic)

**Transition history**:
The chronological log of Takes and Cameo Takes, grouped by engagement — "what did I actually mix, when." Audit and review surface, and the tuning ground for Handover and Guest-engagement detection (false positives included, deliberately). Distinct from the Transition library, which is curated and directional. The cross-Session index, not the only lens: a Session's timeline shows the same Takes in place, and the two deep-link (2026-07-15).

**Session**:
The persisted whole event log of one stretch of live performance — everything the always-on capture tap observes, under one capture clock, all four Decks unconditionally. Bounded by audibility, not by app lifetime (amended 2026-08-13, sessions 11; originally one per recorder lifetime with no boundary heuristics): the row opens on the first Master-audible Deck instant — loads, cueing, control setup, and tenure markers buffer as reconstruction context but never create a row, so a 100%-silent run persists nothing — and ten continuous minutes with no Master-audible Deck end it (machine tenure counts as inactivity; the observed idle tail stays in the old log; no engagement, chunk sequence, or Take provenance spans the boundary; the next Session opens lazily when performance resumes). The container Takes and Cameo Takes are detected within (each carries its Session); idle stretches shorter than the boundary are collapsed by the viewer. Non-performance stretches (editor auditions, Conductor playback) appear as Audible-surface tenure markers, not event streams — the log records that the machine held the surface from X to Y, never what it played. Stores control/transport events only, no audio; auditioning a moment replays events through the shared live Decks — a machine performance holding the Audible surface, invisible to capture, yielding to takeover like the Conductor: a manual gesture ends replay and capture resumes (decided 2026-07-15).
_Avoid_: capture session (the informal precursor, canonicalized 2026-07-15), session recording (implies audio; a Session stores events), whole-session capture (ADR 0020's placeholder phrase), one Session per recorder lifetime (the pre-sessions-11 boundary)

**Transition template**:
A named beat-domain recipe for producing a Transition, in two parts. The **alignment rule**: B's anchor (a cue slot or the Grid origin) lands on A's anchor plus a whole-beat delta — "B's cue 2 lines up with A's cue 4 + 8 beats". B's anchor is the musical reference of the move, typically B's mix-in landmark. The **window**: whole beats before and after the alignment instant (either may be negative; their total, the length, is ≥ 0 — zero is a hard cut at the anchor); scalable templates rescale the total proportionally, keeping the anchor's relative position. Plus normalized automation lanes — only lanes the author gave meaningful content; hidden and untouched lanes are not part of the recipe. Applying translates beats to seconds via the tempo-matched beatgrids and yields an ordinary seconds-based Transition — the recipe is an editing affordance, not a runtime concept. Application never guesses alignment: an anchor that cannot be resolved leaves anchors untouched, while the rest of the recipe still stamps. (Reworked 2026-07-04 from per-side window-start anchors: aligning at the window start forced lead-ins through double-delta arithmetic; anchoring the alignment and windowing around it matches how the move is actually thought.) Templates are kind-specific: a Cameo template uses the same recipe shape but stamps a Cameo, and neither kind cross-applies — their lanes mean different moves (one ends the outgoing, the other returns it).

**Grid origin**:
The true first downbeat of a Track for beat-counting purposes: the earliest downbeat after extending its Beatgrid backward in whole beats toward the track start — correcting grids whose first mark lands a beat or more after the actual first downbeat. An anchor base for Transition templates alongside cue slots.

**Slide**:
Realigning the Track pair in the Transition editor by moving the incoming Track's content relative to the rest. A Slide changes the pair alignment and re-cues only the incoming deck: the playhead's mix position never moves and stays pinned to the outgoing Track, which never hiccups. The incoming deck's controls re-purpose transport gestures as Slides: beat jump = slide by ±N of its own beats; hot cue = slide so that cue and the playhead coincide. The outgoing deck's controls stay plain transport (its track time ≡ mix time — jumping it IS jumping the mix; re-decided 2026-07-03, replacing the earlier mirrored A-slides which duplicated B's under the lock toggle). Distinct from the transport meaning of those gestures on other surfaces. Arrow- and step-shaped Slide controls (beat-jump buttons, alignment nudges, their MIDI ports) follow apparent motion — the arrow's direction is the direction the incoming Track's block moves on screen (decided 2026-07-05, replacing the earlier content-under-playhead polarity). Jogs are exempt: a jog keeps the platter metaphor (spinning forward advances the music).

**Locked window**:
A Transition-editor toggle choosing which Track the Transition window sticks to during a Slide (incoming-deck gestures and block drags only): locked, the window rides the slid Track (the same audio stays under it); unlocked, it stays with the outgoing Track. Double-drop line-up: jump the playhead to the outgoing Track's drop cue, then hot-cue the incoming Track's drop unlocked — the drops align.

**Undo step**:
The unit of undo in the Transition editor: one gesture (press to release), one discrete action (a beat-jump Slide, a stamp, a delete), or one coalesced run of Alignment nudges (broken by any other action or a pause). Undo covers everything the editor autosaves — sketch edits and session operations — never view toggles or selection, though undoing an edit re-selects the Transition it touched. One chronological history per Track pair, spanning the session's Transitions; it ends when the pair is switched.

**Cue-slot convention**:
A library convention (not a code concept) giving hot cue slots stable musical meaning so Transition templates can anchor to them — a ladder into the drop: 4 = drop, 3 = 8 bars before 4, 2 = 8 bars before 3, 1 = first buildup, typically 16 bars before 2. **4 = drop is the firmest rung** — the most strongly held convention in actual DJing; the earlier slots are progressively softer ("typically"). Slots 5–8 carry no convention. At template-apply time a missing slot resolves relative to the nearest set ladder slot, falling back to heuristic positions from the Grid origin only when no ladder slot is set.

**Key**:
One of 24 key centers (12 tonics × major/minor) assigned to a Track. OpenKey is the preferred notation for display and discussion; Camelot, musical, and external libraries' notations are conversions from the same canonical value.

**Key provenance**:
Where a Track's Key came from: `analyzed` (native key Analysis), `imported` (External Import), or `manual` (direct user edit); unknown (e.g. seeded from file tags) ranks below everything. With Beatgrid origin, one half of the overwrite ladder (ADR 0024): bulk/automatic Analysis never overwrites a value that outranks `analyzed`; manual single-track re-analysis overwrites freely.

**Harmonically compatible**:
The relation between two Keys that mix well together. The basis of harmonic-mixing features (Circle of Fifths, finding tracks to mix into).
_Avoid_: related (too vague — could mean same artist, genre, etc.)

**Compatible**:
A heuristic relation between Tracks — the weakest of discovery's three evidence tiers (Known > Observed > Compatible): metadata proposes, Observed shows behavior, Known confirms. A Track is Compatible with a reference when it passes the **BPM gate** (tempo within tolerance of the reference's, or of its double or half — half-time moves are first-class) and clears the Match score's Affinity floor. Nothing else gates: key, tags, energy, and artist are score signals, never filters (rewritten 2026-07-08 from a conjunction of key+BPM gates, which made harmonic mixing a prerequisite and buried same-artist, many-shared-tags candidates; the gate is BPM alone because gates are mechanical — can this blend physically ride? — while evidence is musical and belongs to the score). Follow mode is the feature surfacing this tier; its one-shot ancestors ("Find Compatible", né "Find Related") are retired.

**Match score**:
The weighted heuristic ordering the Compatible tier, combining two kinds of signal. **Affinity signals** — key relation (a bonus ladder over the harmonically-compatible relations; floor zero: a clashing key earns nothing but is never penalized — dnb harmonic content is variable enough that nominal clashes often play fine), Tag overlap (shared-Tag count with diminishing but never-flat returns — more shared Tags always helps at least a bit; categories unweighted), and Shared artist — are evidence two Tracks go together. **Context signals** — BPM proximity (measured after half/double folding, flat near the center) and energy neighborhood (within ±1 of the reference; a rise slightly outranks a drop; beyond ±1 counts for nothing) — are evidence a blend is mechanically comfortable: they shape ordering but never admit a candidate. The **Affinity floor**: a candidate's affinity signals alone must score at least what the weakest compatible key relation would — nothing surfaces worse-evidenced than a compatible key. Missing data is neutral, never negative: an untagged or keyless Track is unboosted, not punished. Known evidence always outranks the score, in Known-strength order. Weights, contribution curves, and the floor value are tunable heuristics, not part of the model.

**Shared artist**:
A symmetric affinity relation between two Tracks: their artist credits, split into individual artist tokens (feat./&/,/x collaborators), share at least one token under typo-tolerant fuzzy comparison. Token-level, so `Sub Focus` matches `Sub Focus feat. Kele`; fuzzy, because the library's artist strings are messy. Extracting remixer credits from titles is a planned extension.
_Avoid_: same artist (implies exact string equality, which the library cannot support)

**Follow mode**:
A per-Deck toggle that keeps the browse list continuously filtered to candidate next Tracks for that Deck's loaded Track, updating hands-off as Tracks change — serving "finding the next track painlessly during a set". A followed Track's candidates carry all three evidence tiers: heuristic Compatible Tracks unioned with the Observed tier and the known tier (Tracks with a saved Transition from it, Tracks with a saved Cameo hosted by it, and Linked Tracks) — a known or Observed Track surfaces even when heuristics would exclude it, and "known only" narrows to just the known tier. With multiple Decks following, their candidate sets union. The followed list is ordered by one total candidate order: the Known strata first (in Known-strength order; a pair takes its best), then Observed (by Take count and recency), then Compatible Tracks by Match score (revised 2026-07-08 from the provisional key-relation tiers); best position wins across followed Decks. The score is a sortable column, the heuristic stratum's default sort — choosing another sort deliberately reorders that stratum, while the Known and Observed strata stay pinned on top. Follow rides playback: once any Deck follows, all playing Decks become references; starting a Deck spreads Follow to it, and pausing one removes it while another plays. The last followed Deck survives full silence. Playback never enables Follow from nothing: when no Deck follows, turning it on is the user's act.

**Observed**:
Discovery's middle evidence tier: an ordered Track pair mixed repeatedly — multiple Takes — with nothing curated for the pair (no Link, no saved Transition). Behavioral evidence, accrued hands-off from normal playing: stronger than Compatible's metadata heuristics, weaker than Known's explicit acts. The Take-count floor is a tunable heuristic (nominally ≥2, because Handover detection is deliberately liberal), not part of the definition; Take count and recency order within the tier. Cameo Takes still count for nothing in discovery until promoted. A pair leaves the tier upward the moment it becomes Known.
_Avoid_: implicit favorite, inferred pair

**Unplaced**:
A Track in the Library, not Archived, and in no Set — set-formation material, the Dig view's default scope. Placement in any Set graduates a Track (blunt by choice, 2026-07-08: no active-Set notion until old-Set pollution actually bites); Playlist membership never does — Playlists are curation and Export artifacts, not set formation. Recency and evidence heat rank the scope but are not part of the definition: nothing falls out from neglect.
_Avoid_: fresh (recency is ranking, not the predicate), candidate (collides with Disk Import candidates and Chain candidates)

**Dig view**:
Discovery's dedicated surface (Follow mode is its ambient sibling; one suggestion engine feeds both, plus an ambient rail of run/chain suggestions for the loaded Track in the Performance view): a browse of set-formation material over the Unplaced scope, organized as shelves — Played runs never acted on, Observed pairs awaiting a decision (Link, review a Take, pin into a Set), Chain candidates, untried Compatible edges, the Wildcard. Shelves, not an inbox (decided 2026-07-08 against the Sync-inbox skeleton): suggestions are not obligations, duplicates across shelves are emphasis, nothing demands clearing. Filter chips (key, tag, …) are session state, never persisted — a persisted pool invites tunnel vision, so no pool artifact exists. Acting on a suggestion jumps elsewhere: audition (Performance view), review (Transition editor), seed or extend a Set (Set view); auditioning from it feeds Take capture as usual, so using the view sharpens the view.
_Avoid_: crate (Serato's playlist term), pool, hub, discovery view (discovery is the faculty, not a view)

**Played run**:
A sequence of Tracks actually mixed end-to-end in one live session, reconstructed from the Transition history by time-adjacent Takes — never stored, always mined; the session clock Takes already share makes the run recoverable verbatim. The strongest chain evidence: every adjacency was mixed *in sequence, that night*. Seeding a Set from a Played run creates the Set in that order and pins the run's Takes — the per-run form of the deliberate Take-pinning act, so the seeded Set plays back the night that inspired it rather than hard-cutting.

**Chain candidate**:
A derived proposal: a path over Known and Observed edges whose full sequence was never played end-to-end — every adjacency has pairwise evidence, the run itself is hypothesis. Dig-view vocabulary, never a persisted artifact (decided 2026-07-08): the evidence layer (Takes, Links, Transitions) is the only persistence, and acting on a chain means seeding or extending a Set. Path-finding parameters are tunable heuristics.
_Avoid_: chain (bare noun implies a stored artifact)

**Wildcard**:
The deliberate randomness slot in discovery's surfaces: alternates between a neglected Unplaced Track (sampled by anti-ranking — old, evidence-free, never auditioned) and an untried pair (Compatible, zero Takes). Reroll is its only control; it respects the active filter chips (spice within tonight's vibe, not against it) and never blends into ranked or evidence-ordered lists. The untried-pair form is an evidence generator: audition it and the loop closes — Take, Observed, Chain candidate.
_Avoid_: shuffle, ranking jitter (rejected: noise inside a ranking makes the ranking untrustworthy)

**Seed Set from Playlist**:
A gesture creating a Set from a Playlist: the Play order becomes the Set's order, adjacencies Unresolved; the source Playlist is untouched and no link between them persists. The standing bridge from playlist-first planning (the giant playlist firms up, then one gesture hands over to the Set editor), and the one-time migration for playlist-era sets so Unplaced graduation reflects history.

### Performance data

**Analysis**:
Automatically determining a property of a Track from its audio — key, BPM, beatgrid, waveform, Structure, Energy estimate. Manual edits to those properties are orthogonal to Analysis.

**Section**:
An Analysis-produced labeled span of a Track: intro, buildup, drop, breakdown, outro, or other. Boundaries land on the Beatgrid's downbeat lattice (unsnapped on gridless Tracks). Buildup is relational — it ends where a drop begins; one without a following drop is a detector error by definition. Never hand-edited: the correction surface is the cue ladder, and consumers read Hot Cue slot 4 over the detected drop wherever both speak (the two-rung read).
_Avoid_: phrase (a Metric-ladder unit of ambiguous size, and Rekordbox's feature name), segment (MIR jargon)

**Structure**:
A Track's full partition into Sections — the analysis fact of where its drops, buildups, and breakdowns are. Re-runnable opinion, replaced wholesale on re-analysis; detector-label mappings and thresholds are tunable heuristics, not part of the definition. Internal to manadj — never transferred by Sync, like Waveform data.

**Energy estimate**:
The analysis opinion of a Track's Energy (1–5): drop-centric — keyed on drop-Section intensity, whole-track when gridless — and calibrated against the library's hand-rated Tracks. Never exported; read only where curated Energy is unset, and always displayed as an estimate, never as the verdict.

**Ladder stamp**:
The explicit act (single Track or bulk) of writing a cue ladder from a Track's Structure per the Cue-slot convention: slot 4 on the first drop, earlier rungs walked back, filling empty slots only. Stamped cues become ordinary Hot Cues with no memory of their origin. Analysis never writes cue slots itself — the stamp gesture is the consent.
_Avoid_: auto-cue (implies analysis writes cues unasked), bare "stamp" (a Transition template also stamps)

**Needs-attention worklist**:
The library view of Tracks whose grid Analysis bailed and that still have no saved grid — derived, never stored: the flag clears the moment the Track gains a grid from any saved origin (hand edit, External Import, or a successful re-analysis). A generated placeholder does not clear it. The curation surface for unquantized tracks (ADR 0024: the analyzer refuses to guess at them).

**Ground truth corpus**:
The set of Tracks whose key/BPM/Beatgrid values are externally verified, used as the measuring stick for Analysis accuracy: candidate analyzers are scored by agreement with it, not by vibe. Tiered by agreement: *gold* where Engine DJ and Rekordbox concur (headline scoring), *disputed* where they disagree — excluded from scoring until hand verification promotes them. Grid phase is Engine-only (no Rekordbox performance data).

**Deck**:
An independent playback unit: one loaded Track plus its transport state (playhead, playing/paused, Main cue) and pitch. Four fixed Decks exist — Deck A, Deck B, Deck C, and Deck D — owned by the application, not by any view: a Deck outlives views and keeps playing across them. Alternate displayed labels may be offered without changing these identities. The standalone Library player presents Deck A; four-Deck work happens in the Performance view. Per-Deck sound shaping (trim, EQ, filter, volume) belongs to the Mixer's channel strips, as on hardware.

**Deck color**:
The per-Deck identity color used across every surface: Deck A cyan, Deck B magenta (as established by the Transition editor). Identity only — state colors (green for active/playing, blue for accents) never denote a Deck, and Deck colors never denote a state. Colors for per-deck things (e.g. automation lanes) live inside the deck's hue family — near-cyan hues belong to A, near-magenta to B — with a fixed role→hue-offset shared by both decks, the deck color itself marking the deck's primary element (2026-07-05).

**Mixer**:
The single shared output stage: one channel strip per Deck (trim, 3-band EQ, sweep filter, channel fader), plus crossfader, master volume, and an always-on final sample ceiling. Neutral trim is -6 dB, supplying expected two-channel summing headroom; Master has explicit unity at 50% and +6 dB at maximum; the -2 dBFS Master/Cue ceiling guards overload without changing ordinary program loudness. Each channel may be assigned to the crossfader's left side, right side, or neither; Deck identity does not determine that assignment. Mirrors a hardware DJ mixer.

**Audible surface**:
A playback mode's claim on the shared Decks+Mixer — the plain deck-transport semantics of the Performance and library views, or the Transition editor's mix-timeline semantics. Exactly one surface is audible at a time; an arbiter owns which, and a displaced surface's playback pauses rather than coexist. Playback gestures from app-wide inputs (a Controller) route by gesture class — transport, cue, pads, jumps, loops, jog — to the audible surface; a class the surface doesn't register is dropped, mirroring what the keyboard does there. Mixer-state controls and Load are not gesture classes: they belong to the shared Mixer and to the mounted browse view respectively. (Redefined 2026-07-05: formerly a group of playback machinery that could produce sound as a unit — the editor had a private player; every surface now plays through the shared Decks+Mixer.)

**Performance view**:
The four-Deck view for practicing and performing mixes: four stacked full-width waveforms with linked zoom, a 2×2 grid of Deck controls, the Mixer, and the Library's browse surface embedded below. All four Decks remain visible regardless of Controller focus. Replaces the Practice view. Curation beyond quick edits (tags, provenance) stays in the library view.

**Load**:
Placing a Track on a Deck for playback — an explicit act, as in DJ hardware. Selecting a track in the library browses without loading; the Deck keeps its Track until another Load replaces it. In the Performance view, Loading onto a playing Deck is blocked (protecting the mix); in the library it simply replaces what's playing.

**Nudge**:
A momentary tempo bend on a Deck used to ride phase alignment against the other Deck — held (a key or button) or impulse-driven (jog wheel rotation); when the input stops, the Deck's pitch is restored exactly. Distinct from a *grid nudge*, which shifts a Track's Beatgrid and changes stored data — a Nudge changes only what is playing right now. Jog rotation on a paused Deck is a seek, not a Nudge. The Transition editor's counterpart of the same intent is the Alignment nudge.

**Play guide**:
A derived, view-only marker in the Performance view: one per saved Transition from a playing outgoing-candidate Track to a paused Track, marking the instant to press play on the paused Deck so the pair rides that Transition's alignment. Every applicable playing→paused pair gets its own guide; a guide identifies both Decks and spans only their waveform rows. When all applicable Decks are paused, both directions may show; starting a Deck prunes guides to live directions. Computed from the Transition's alignment and tempo-match ratio and the paused Deck's current playhead (works wherever the incoming Track is cued), projected on the trajectory before the Transition's first Jump event. A missed guide (already behind the playhead) stays visible rather than disappearing. Labeled with the Transition's name and carrying the incoming (to-be-pressed) Deck's color. Purely visual — never stored, never editable, never enforcing pitch (a pitch mismatch against the Transition's tempo-match is surfaced, not corrected).
_Avoid_: transition guide (collides with Transition template), entry/cue marker ("cue" is overloaded)

**Quantize**:
An app-wide sticky toggle (default on) making beat-relative performance gestures grid-aligned: cue and Hot Cue placement snap to the nearest beat, auto-loop regions snap to the nearest beat, and Hot Cue jumps while playing are phase-preserving — a whole-beat displacement landing at the cue plus the playhead's intra-beat phase, so the groove never stumbles. Evaluated at gesture time; imports are not gestures and never snap. Gridless Tracks behave as if it were off. Beat jump (inherently whole-beat), cue return, paused-cue seeks, loop halve/double, and Transition-editor snapping are outside its authority.
_Avoid_: snap (the Transition editor's separate affordance), quantization (the Analysis sense — see Quantized track)

**Key Lock**:
A sticky per-Deck setting (default on): playback-rate changes on that Deck (pitch fader, Nudge) do not shift the loaded Track's Key. Belongs to the Deck — not to the Track, not to the Mixer. Named tension: DJ-jargon *pitch* (the fader, the Deck's ±% rate) changes tempo; Key Lock keeps the *musical* pitch — the Key — constant while it does. Also known as master tempo (Pioneer).
_Avoid_: "pitch-preserving", "pitch shift" — "pitch" already means the rate control.

**Alignment nudge**:
Realigning the Transition editor's pair by a fixed time step — the editor's counterpart of a performance Nudge: both ride the pair's relative alignment, but a Nudge does it live and leaves nothing behind, while an Alignment nudge edits the sketch (autosaved). A Slide variant. Distinct from a grid nudge, which edits the Track's stored Beatgrid.

**Hot Cue**:
One of 8 persistent saved positions in a Track, used to jump to during performance.

**Active loop**:
A per-Deck transport region the playhead wraps in while playing — set by auto-loop (a beat-domain length anchored at the playhead, edges snapped per Quantize), resized live by halve/double — pure ×2/÷2 from the current length, clamped to the range (start edge fixed; a shrink that strands the playhead re-enters it at its phase modulo the new length). Beat-domain: lengths are dyadic beat counts within 1/8–128 (default 4); the UI and Controller engage from preset ladders, but the ladder is not the domain. Seconds are a projection through the Beatgrid, so gridless Tracks cannot auto-loop. Deck state like the playhead — survives view switches and surface displacement, cleared by Load. Relative motion (beat jump) translates the region with the playhead; absolute relocation (Hot Cue trigger, cue return, seek) cancels it. Manual loop in/out and slip-behind loop rolls are deferred.
_Avoid_: loop roll (a different, slip-based feature)

**Saved loop**:
Planned concept: a persisted loop region on a Track, Hot-Cue-like (slots, Sync with Engine DJ's loops), from which an Active loop can be armed. Deferred until the Active loop exists.

**Main cue**:
The single repositionable cue position of a Track, moved with the "cue" button while DJing — distinct from Hot Cues by being one slot that moves freely during performance. Persisted with the Track (CDJ memory-cue behavior). When unset, it defaults to the Track's first beat if a Beatgrid exists, else the first non-silent audio; the default is live until touched — a Beatgrid arriving while the Deck is still parked untouched upgrades it to the first beat, but the first play or cue move freezes it (revised 2026-07-10 from strictly load-time).

**Controller**:
A hardware MIDI control surface (e.g. the DJControl Inpulse 300 MK2) driving Decks, Mixer, and library browsing. An alternative input alongside keyboard and pointer — a Controller adds no new capabilities, only physical access to existing actions — plus Feedback on its own lights. Active app-wide, like the Decks it controls, not tied to any view.

**Control focus**:
The pair of application Decks currently addressed by the left and right layered control surfaces, shared by Controller and keyboard input. On a two-surface, four-Deck Controller, one Deck is focused on each side; changing either side from hardware or keyboard, or interacting with an on-screen Deck panel, updates the same focus. Focus changes input routing and its UI emphasis only; it says nothing about which Decks are loaded, playing, audible, or followed.

**Mapping**:
The device-specific translation from a Controller's physical controls to manadj actions, and of manadj state to the Controller's Feedback addresses. One Mapping per device model; controls with no manadj counterpart are simply absent from it and do nothing. A counterpart is assigned, not read off the silkscreen: a Mapping may repurpose a control away from its printed label for any existing action whose gesture shape (momentary, toggle, continuous) and scope (Deck-surface, channel-fixed, global) match the physical control — label affinity is a preference for choosing among candidates, never a requirement (resolved 2026-07-13; the GRV6 runs only manadj, so foreign-software muscle memory is not protected).

**Feedback**:
Device-directed output that mirrors existing on-screen state on a Controller's lights (hot cue pads, transport LEDs). A layered deck surface mirrors its focused Deck and repaints when Control focus changes; unfocused Decks remain visible on screen rather than simultaneously represented on that surface. Feedback never carries information the screen doesn't already show, and losing it changes nothing about what the app can do.
_Avoid_: LED sync, output mapping

**Cue bus**:
The second audio output alongside the Master bus: what the DJ's headphones play. Fed by per-channel PFL taps (post-EQ/filter, pre-fader, pre-crossfader) blended with an adjustable taste of master. Independently routable to any output device.
_Avoid_: headphone bus, monitor bus

**PFL**:
Pre-fader listen — a per-channel toggle putting that channel on the Cue bus regardless of its fader or the crossfader. Both channels may be on at once.
_Avoid_: headphone cue (as the toggle's name), solo

**Beatgrid**:
The mapping of beat positions across a Track, including tempo changes. Produced by Analysis, edited by hand, or brought in by External Import. A *placeholder grid* merely generated from the Track's BPM is not saved info — it may be replaced without confirmation, unlike an edited or imported grid. When a Beatgrid exists it is the authority on tempo: the Track's BPM is its projection (the grid's dominant tempo), not an independent field, and editing BPM is a grid operation (ADR 0016). A grid may carry an *anchor* — the downbeat the user explicitly marked — which re-tempo operations never move.

**Metric ladder**:
A Track's tiers of metric grouping above the bar: bars group into higher-tier units (hypermeter), each tier splitting duple or triple — in practice duple everywhere, giving the 2-, 4-, 8-, 16-bar tiers dance music runs on. Defined over the Beatgrid's downbeat lattice — the Beatgrid remains the sole authority on beats and bars (tempo and time signature), and the ladder only answers how bars group upward. Anatomy: an ordered stack of arities up from the bar, plus Reset marks; counting between marks is perfectly regular. Sub-bar grouping (the 2-beat strong/weak unit) is a projection of the time signature, not part of the ladder. Tiers are positions on the ladder, not named model concepts — "phrase" is deliberately not a model term (DJ usage ambiguously means 4, 8, 16, or 32 bars; say the tier's size instead — "4-bar group"). Every gridded Track has a ladder: the default — duple tiers from the Grid origin, no Reset marks — is a computed guess, not saved info (the placeholder-grid posture); only deviation is persisted. Manadj-internal, like Waveform data: never transferred by Sync, outside Divergence and Export; external phrase data could someday feed it as an Import source, never as a synced field.
_Avoid_: phrase (ambiguous size; also Rekordbox's feature name)

**Reset mark**:
A downbeat where a Track's Metric ladder recounts from 1 across all tiers — how irregular hypermeter (fakeout extensions, pickup bars, inserted bars) is expressed. Parenthetical bars are derived, never stored: between marks, complete groups form bottom-up and a trailing incomplete group is the "extra bars" — with the discipline that orphans must trail, so a leading orphan (a pickup) is isolated by one more mark. Refers to a moment in track time and resolves to the *nearest downbeat at read* — a pure projection, never rewritten: grid edits and even full grid replacement never destroy or invalidate marks (a bad re-grid makes them land visibly oddly; the fix is fixing the grid). On a gridless Track the ladder is undefined — persisted marks lie dormant until a grid returns. A mark resets every tier; tier-selective resets are deliberately unrepresentable until real music demands them. The earliest mark is additionally the Ladder anchor.

**Ladder anchor**:
The earliest Reset mark on a Track — derived, never stored (ADR 0030): it governs the region BEFORE it, which counts backward, right-aligned to the anchor, with the parenthetical rules mirrored. Complete groups peel greedily and recursively from the anchor toward the track start; only the LEADING remainder too small for the bottom tier is parenthetical — a pickup, honestly flagged with zero extra marks. Inferred bars between the Grid origin and the first stored downbeat participate in the peel and in parenthetical ordinals. One mark on the drop therefore realigns the whole structure in one move — the marking workflow's primary gesture. An 8-bar intro reads "1 of 8 … 8 of 8", not "9 of 16 …"; 20 bars derive as 4 + 16, 24 as 8 + 16, and 32 as 16 + 16. Adding a mark before the current anchor re-anchors there and demotes the old anchor to an ordinary reset. With no marks at all, the ladder anchors at the Grid origin and counts forward, as ever.

**Drop anchor**:
The gesture asserting a Track's drop as one musical fact expressed three ways: the Beatgrid anchor (set-downbeat), the Ladder anchor (a Reset mark), and Hot Cue 4 — all at the playhead instant, playhead-exact (it defines the grid, so there is no grid to defer to). Cue 4 moves if already set (it IS the drop assertion); the softer cue-ladder rungs 3/2/1 fill only empty slots at −8/−16/−32 bars (skipped when landing before the track start); the ladder mark is add-only. Applied atomically — a stamp never half-lands. Deletes nothing; re-anchoring moves the two anchors and cue 4 and leaves any stray soft rungs or marks to visible one-tap deletes.
_Avoid_: drop stamp (templates stamp), drop pin (Sets pin), drop mark (Reset mark dilution)

**Grow / Shrink**:
The fine re-tempo pair on a Track's Beatgrid: growing widens beat spacing (BPM down a hair), shrinking tightens it (BPM up). A grid operation like any BPM edit, honoring the grid's anchor. Distinct from a grid nudge, which translates the grid without changing its tempo.
_Avoid_: BPM nudge (collides with both the performance Nudge and the grid nudge)

**Quantized track**:
A Track produced against a fixed tempo grid, so a constant-tempo Beatgrid (BPM + phase) is its correct description — nearly all of the library. Native grid Analysis assumes quantization: it fits a constant grid to detected beats, and bails (no grid, flagged for attention) rather than emit a wobbly variable grid when the fit is poor. Raw beat-tracker ticks are evidence for the fit, never the grid itself.

**Waveform data**:
The stored Analysis artifact for a Track's audio: broadband peaks plus per-band energies over time, style-agnostic — no aesthetic choices baked in. Internal to manadj — never transferred by Sync; each external library computes its own.

**Waveform**:
A rendering of a Track's Waveform data in manadj's player UI. Many render styles can be drawn from the same Waveform data; style is a display concern, not an Analysis one.

**Waveform style**:
A named render recipe over Waveform data: a shader variant plus its tunable display parameters (band grouping, per-group gain, gamma, smoothing). A display concern — never baked into Waveform data; switching or tweaking a style never requires re-Analysis.

### Acquisition

**Source**:
A place Source Items come from — where demand for tracks originates (SoundCloud likes today). Unlike an External library, a Source holds no copy of manadj's library state. Either Native or External. Distinct from a Supplier: a Source is where wanted tracks are discovered; a Supplier is where audio is obtained. SoundCloud is both.

**Supplier**:
A place manadj can obtain audio from. SoundCloud and Soulseek are Suppliers; Soulseek is supply-only — it has no Source Items. A Source Item may be fulfilled through any Supplier; Audio Provenance records which one actually supplied the audio. Either Direct or Search.

**Direct Supplier**:
A Supplier where the Source Item itself addresses the audio — fulfillment is a download, no choosing involved (SoundCloud).

**Search Supplier**:
A Supplier with no per-item address: candidates are found by searching, and one must be picked before download (Soulseek). Only Search Suppliers involve a picker.

**Native Source**:
A Source manadj is integrated with: it can Refresh Source Items from it (SoundCloud today). Provenance recorded from its downloads carries a structured external ID. Whether it can also supply audio is a Supplier question, not a Source one.

**External Source**:
A Source manadj recognizes but is not integrated with (e.g. Beatport, YouTube, Bandcamp). Identified by URL only — the URL carries whatever identity exists (video ID, Beatport ID). Provenance from an External Source is asserted by the user. An External Source can be promoted to Native later; its provenance URLs remain parseable.

**Acquisition**:
The pipeline that turns Source Items into Tracks: Refresh, classification and queueing, download, Disk Import, and creation of the Source Correspondence. Distinct from Export/External Import, which transfer state about existing Tracks.

**Source Correspondence**:
An association between a Track and a track on a Source — "this Track is that SoundCloud track" — keyed by the Source's stable ID. Independent of where the Track's audio actually came from.

**Source Item**:
A track on a Source that manadj knows about and considers a candidate for acquisition (e.g. a SoundCloud like). Persisted with a lifecycle: new → queued → fulfilled (a Source Correspondence to a Track exists) or ignored.
_Avoid_: like (SoundCloud-specific; fine informally, not in code/issues)

**Classification**:
A heuristic-assigned, user-overridable category on a Source Item: track, mix, clip, or other. A suggestion for filtering — a Classification never ignores anything by itself.

**Refresh**:
Fetching the current list of Source Items from a Source. Only ever adds new Source Items; unliking/removal upstream never deletes local state.

**Cleanup**:
Normalizing raw metadata from a Source or filename into canonical Track title and artist — junk-token stripping, `Artist - Title` splitting, uploader fallback.

**Audio Provenance**:
A record of where a Track's current audio file came from: an origin label (the Source's name, derived from the URL host for External Sources), an optional URL, and when it was acquired. Recorded automatically for downloads manadj performs; asserted otherwise — by the user, or derived automatically from file hints at Disk Import (yt-dlp IDs, purchase tag URLs). Label-only provenance is allowed for URL-less origins (cd-rip, unknown). Asserted provenance stays editable; recorded provenance is ground truth and cannot be overwritten by an assertion. Replacing a Track's audio replaces its provenance. Distinct from Source Correspondence: a Track can correspond to a SoundCloud track while its audio was bought elsewhere.

### Sync

**Surface**:
A place a track can exist: Disk (a file in the tracks directory), Library (a manadj Track), Engine DJ, or Rekordbox. The unified sync view shows one row per track matched across Surfaces; row identity comes from Match, so it inherits Match's limits (a renamed file appears as two rows until External Correspondence exists).

**External library**:
A library owned by another program (Engine DJ or Rekordbox) that manadj reads from and writes to. Both are live Export targets.

**Sync**:
Colloquially — and in the UI — the broad umbrella for everything that moves tracks or track data in or out of manadj: Export, External Import, Disk Import, and Acquisition. Too broad for code: name modules and operations by the specific term instead.
_Avoid_: generic "sync" in module/function names

**Export**:
A Sync operation that pushes Library state out to another Surface — creating missing tracks downstream, or writing diverged fields (including ID3 tags on the Disk Surface). The common case; manadj's state wins — except that an empty Library value never overwrites a Surface's value: Export skips that field, surfaces a warning, and the operator resolves it manually (usually by Importing).
_Avoid_: publish, push, write-to-files (that's Export to Disk)

**Import**:
Any operation that brings tracks or track data into manadj. Two kinds: Disk Import and External Import.

**Disk Import**:
New audio files from the tracks directory becoming Tracks: a Scan discovers candidates, accepting a candidate creates a Track.

**External Import**:
A Sync operation that pulls state from an external library into manadj, for data that originated downstream — keys/BPM analyzed in Engine, hot cues set at a gig, tracks added elsewhere first. Less common than Export but routine, not exceptional. The counterpart of Export.
_Avoid_: pull, Library Import

**Scan**:
The discovery step of a Disk Import: finding audio files in the tracks directory that are not yet Tracks and proposing them as candidates.

**Diverged**:
A track field (title, artist, key, BPM, energy, Tag assignment, Hot Cues, Beatgrid, Main cue) whose value differs between the Library and another Surface. The default resolution is Export (manadj wins); Import is the explicit exception. Set-valued fields (Tag assignment, Hot Cues) compare as whole sets; a placeholder grid counts as absent, not as a value that can diverge.
_Avoid_: discrepancy (implementation term)

**Match**:
The association between a Track and its counterpart in an external library, established during a Sync operation by file path, falling back to filename. Recomputed each run; not persisted.

**Sync inbox**:
The default unified-sync presentation: every attention-worthy track appears exactly once, in the highest-priority section that applies. Answers "what should I deal with, in what order" — a triage view, not a query.

**Divergence filter**:
An active chip in the unified sync view — a predicate listing every track carrying that divergence, regardless of which Sync inbox section claimed it. Chip counts always reflect the predicate, so a chip's number and its section's size may legitimately differ.
