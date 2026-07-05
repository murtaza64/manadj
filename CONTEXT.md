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
The Transition editor's timeline starts at the outgoing Track's start — an invariant, not a setting. The outgoing Track never moves on the timeline; every alignment gesture is expressible as a Slide of the incoming Track, the window, or both.

**Transition editor**:
The top-panel mode (a sibling of the library and Performance views) for editing the saved Transition between two loaded Tracks on a DAW-style timeline. Its auditions play through the shared Decks and Mixer; entering it pauses shared playback — one audible surface at a time.

**Set**:
An ordered sequence of Tracks whose adjacencies each pin, by explicit reference, a saved Transition, a Take, or nothing (unresolved) — the planned form of a DJ set. Pins are stable: saving new Transitions for a pair never changes an existing pin. Auto-fill may propose Transitions (favorite first) but never a Take — Takes are by definition unreviewed, so pinning one is always a manual act; promoting a Take re-points every Set pin to the resulting Transition. Reordering never destroys a pin: a broken adjacency's pin goes Dormant and restores if the pair becomes adjacent again. Renames the former "Mix" concept (2026-07-05), which collided with the Classification value "mix" (an externally recorded DJ mix on a Source). Distinct from a Playlist: a Playlist's identity is hand-curated order for curation and Export; a Set's identity is its adjacencies and what they pin.
_Avoid_: mix (retired), setlist, auto playlist

**Dormant pin**:
A Set's memory of a pin whose adjacency was broken by reordering or removal — kept per ordered pair, per Set, and restored automatically when that pair becomes adjacent in that Set again (restoring a manually-pinned Take honors the original manual act). Strictly per-Set: another Set with the same pair gets auto-fill, not this Set's memory. Makes reordering non-destructive — the discard warning it replaced (decided then overturned 2026-07-05) is gone.

**Set playback**:
Playing a Set end-to-end via the Conductor: Tracks ping-pong across the two shared Decks, each playing solo from its entry until the next pinned Transition's window, whose position on the outgoing Track's timeline is given by the Transition itself. A Take pin plays its idealized vectorization. An unresolved adjacency hard-cuts: the outgoing Track plays to its end, the incoming starts at its Main cue — playback never stalls. (A future practice mode may instead hand unresolved boundaries to the user, capturing a Take.)

**Conductor**:
The automation driver that performs Set playback on the existing performance surface — loading Decks, starting transports, and moving Mixer controls per the pinned Transitions. Not a new Audible surface: the Decks and Mixer behave plainly, and any view showing them visualizes the Set as it plays. It has its own transport — play, pause, seek — which are Conductor controls, not takeover triggers; a seek is an evaluation of the playback plan at a mix-time instant (deck positions, lane values mid-window, tempo state), legal into the middle of a Transition and while paused. Any manual deck or mixer gesture stops the Conductor entirely — the Decks keep playing as they are and the user is mixing live (per-control takeover deferred). Conductor-driven playback is invisible to Take capture, like editor auditions; capture resumes at takeover. A Transition's lanes address the outgoing/incoming roles, not physical Decks: the Conductor maps roles onto Decks per its ping-pong parity, and the Transition editor always presents outgoing-as-A.

**Unresolved**:
A Set adjacency with nothing pinned — no Transition, no Take. Says only "playback will hard-cut here"; the pair may still be well-practiced (evidence exists, not yet pinned — an auto-fill candidate). Orthogonal to Unpracticed.

**Unpracticed**:
A Set adjacency whose ordered pair has no saved Transition and no Take — these two Tracks have never been mixed, in either artifact's sense. The Set's rehearsal to-do list. Orthogonal to Unresolved: an adjacency can be unresolved yet practiced, and (via a pinned Take) resolved yet never promoted.

**Tempo policy**:
A per-Set choice governing tempo during Set playback. **Riding**: each incoming Track eases back to its native tempo between Transitions (see Tempo return). **Fixed**: the entire Set plays at the Set tempo — every Track pitched to it, Transitions rate-scaled as a whole; a pinned Transition's tempo-match flag is moot. One policy per Set; per-section tempo progression is deferred.

**Set tempo**:
The single BPM a Fixed-policy Set plays at. Explicit and editable on the Set, defaulted from the first Track's native BPM. Has no meaning under Riding.

**Tempo return**:
Under the Riding policy, the eased ramp of an incoming Track from its tempo-matched rate back to native after a Transition's window closes — the pitch-fader ride-back a DJ performs by hand. Ramp speed is a tunable heuristic, not part of the model; a ramp that cannot complete before the next window is a Set validation flag (insufficient runway), clamped faster rather than left incomplete.

**Favorite**:
A boolean on a Transition marking a proven move — asserting both "these Tracks go well together" and "this specific Transition is good." The unit discovery ranks by. Distinct from a Track's Rating.
_Avoid_: like (social-app connotation).

**Preferred pair**:
Retired term (2026-07-05). "An ordered Track pair with at least one favorited Transition" is now an unnamed derived property — say it longhand. Its starred Transition-library marks remain; the stored, toggleable pair association it deliberately excluded now exists as Linked.

**Linked**:
A stored, symmetric, user-toggled assertion that two Tracks go well together — one fact per unordered pair of distinct Tracks (never self-Linked), toggleable whenever the pair is loaded together (Performance view, Transition editor). Independent of Favorite at write time: favoriting a Transition never links, unfavoriting never unlinks; discovery's effective "goes well together" set is the query-time union of Linked and pairs with a favorited Transition. Surfaces as a symmetric library-row mark relative to each loaded Track, alongside the directional Transition-library marks. Feeds discovery (Follow mode) and future set-building.
_Avoid_: pairing, preferred pair. Note: "Link" as a Track↔external-library association is now External Correspondence.

**Known**:
The relation between two Tracks when they are Linked or a saved Transition connects them — discovery's confirmed evidence tier, as opposed to the heuristic Compatible tier. Within the tier, strength orders favorited Transition, then Linked, then unfavorited Transition; a pair takes its best. "Known only" is the Follow-mode filter narrowing to this tier (formerly "proven only").
_Avoid_: proven (connotes a rehearsed Transition, which a bare Link isn't)

**External Correspondence**:
Planned concept (formerly "Link", renamed 2026-07-05 to free Linked for the Track-pair assertion): a stored association between a Track and its counterpart row in a specific External library, keyed by that library's stable internal ID. The sibling of Source Correspondence — one Correspondence family: stable-ID-keyed associations between a Track and its representation in another system.

**Transition library**:
The queryable index over saved Transitions — "what mixes out of / into this Track" — surfaced as library-row marks and discovery filters. Directional, like the Transitions it indexes. Takes are not in it: only promotion adds to the library.

**Take**:
A Handover detected and captured automatically during live performance playback — playback while the shared Decks+Mixer surface is audible; Transition-editor auditions are invisible to capture, even though they play through the same Decks — a track pair plus the recorded performance, weaker than a Transition. Takes live in the Transition history, never in the Transition library. Reviewed in the Transition editor; **promoting** a Take converts it into an ordinary saved Transition (recording is a capture method, not a new artifact kind downstream). Promotion idealizes: continuous gestures (Nudge, pitch riding) collapse into the Transition's single alignment and tempo-match; crossfader and channel-fader work compose into the per-deck fader lanes; discrete gestures (beat jumps, hot-cue jumps) are preserved as Jump events, and a loop engagement collapses to one repeated Jump event rather than k wraps. Unpromoted Takes are audit data with one non-audit use: a Set adjacency may pin one (manually, never by auto-fill), playing its idealized vectorization without creating a Transition. Takes from one capture session share a clock, so the pairwise Takes of a multi-deck engagement (a double or triple) remain time-correlated — the full move is reconstructable from its pairs.
_Avoid_: recorded Transition (a Take is not a Transition until promoted)

**Handover**:
The detection target for Takes: audibility on the Master bus passes *finally* from the outgoing Track to the incoming — the incoming becomes audible while (or shortly after) the outgoing is, and the outgoing then stays silent. The definition applies per ordered pair: when more than two Decks are audible, one engagement emits a Take for every ordered pair that meets it (deliberately liberal — Takes are audit data; curation happens at review). A Track may hand over to itself (the same Track on two Decks — a dnb double against itself). Brief returns of the outgoing (cross-cuts — dnb teases, double drops) fold into the same Handover rather than ending or splitting it; a tease where the outgoing survives is no Handover at all. Zero-overlap hard cuts are Handovers. Cue-bus (PFL) audibility is invisible to detection. A Take's window is the whole engagement — the contiguous period the two Tracks trade or share audibility, ending at the outgoing's final cessation. Thresholds and settle horizons are tunable heuristics, not part of the definition.

**Jump event**:
A playback discontinuity inside a Transition — the incoming Track's playhead jumps to a new position at a mix instant (a beat jump or hot-cue press mid-mix, e.g. doubling a buildup). May carry a repeat count: a backward Jump repeated k times recurs at its own displacement's period — which is exactly a loop, so loops need no separate Transition vocabulary. A repeat count is only coherent on a backward Jump (a forward one has no natural period). Intentional structure, unlike a Nudge. Incoming-Track-only for now (the Sketch origin invariant keeps the outgoing Track's time ≡ mix time); outgoing-side jumps may be admitted later, which would restate that invariant.

**Transition history**:
The chronological log of Takes — "what did I actually mix, when." Audit and review surface, and the tuning ground for Handover detection (false positives included, deliberately). Distinct from the Transition library, which is curated and directional.

**Transition template**:
A named beat-domain recipe for producing a Transition, in two parts. The **alignment rule**: B's anchor (a cue slot or the Grid origin) lands on A's anchor plus a whole-beat delta — "B's cue 2 lines up with A's cue 4 + 8 beats". B's anchor is the musical reference of the move, typically B's mix-in landmark. The **window**: whole beats before and after the alignment instant (either may be negative; their total, the length, is ≥ 0 — zero is a hard cut at the anchor); scalable templates rescale the total proportionally, keeping the anchor's relative position. Plus normalized automation lanes — only lanes the author gave meaningful content; hidden and untouched lanes are not part of the recipe. Applying translates beats to seconds via the tempo-matched beatgrids and yields an ordinary seconds-based Transition — the recipe is an editing affordance, not a runtime concept. Application never guesses alignment: an anchor that cannot be resolved leaves anchors untouched, while the rest of the recipe still stamps. (Reworked 2026-07-04 from per-side window-start anchors: aligning at the window start forced lead-ins through double-delta arithmetic; anchoring the alignment and windowing around it matches how the move is actually thought.)

**Grid origin**:
The true first downbeat of a Track for beat-counting purposes: the earliest downbeat after extending its Beatgrid backward in whole beats toward the track start — correcting grids whose first mark lands a beat or more after the actual first downbeat. An anchor base for Transition templates alongside cue slots.

**Slide**:
Realigning the Track pair in the Transition editor by moving the incoming Track's content relative to the rest. A Slide changes the pair alignment and re-cues only the incoming deck: the playhead's mix position never moves and stays pinned to the outgoing Track, which never hiccups. The incoming deck's controls re-purpose transport gestures as Slides: beat jump = slide by ±N of its own beats; hot cue = slide so that cue and the playhead coincide. The outgoing deck's controls stay plain transport (its track time ≡ mix time — jumping it IS jumping the mix; re-decided 2026-07-03, replacing the earlier mirrored A-slides which duplicated B's under the lock toggle). Distinct from the transport meaning of those gestures on other surfaces.

**Locked window**:
A Transition-editor toggle choosing which Track the Transition window sticks to during a Slide (incoming-deck gestures and block drags only): locked, the window rides the slid Track (the same audio stays under it); unlocked, it stays with the outgoing Track. Double-drop line-up: jump the playhead to the outgoing Track's drop cue, then hot-cue the incoming Track's drop unlocked — the drops align.

**Cue-slot convention**:
A library convention (not a code concept) giving hot cue slots stable musical meaning so Transition templates can anchor to them — a ladder into the drop: 4 = drop, 3 = 8 bars before 4, 2 = 8 bars before 3, 1 = first buildup, typically 16 bars before 2. **4 = drop is the firmest rung** — the most strongly held convention in actual DJing; the earlier slots are progressively softer ("typically"). Slots 5–8 carry no convention. At template-apply time a missing slot resolves relative to the nearest set ladder slot, falling back to heuristic positions from the Grid origin only when no ladder slot is set.

**Key**:
One of 24 key centers (12 tonics × major/minor) assigned to a Track. OpenKey is the preferred notation for display and discussion; Camelot, musical, and external libraries' notations are conversions from the same canonical value.

**Harmonically compatible**:
The relation between two Keys that mix well together. The basis of harmonic-mixing features (Circle of Fifths, finding tracks to mix into).
_Avoid_: related (too vague — could mean same artist, genre, etc.)

**Compatible**:
A heuristic relation between Tracks: key, tempo, energy, and tag agreement suggest they would mix well. Tag agreement means sharing at least one Tag — never requiring all Tags to match; if any-shared proves too loose, the refinement is scoping to chosen Tag Categories. One of discovery's two evidence tiers — heuristics propose, the known tier confirms (Linked pairs and the Transition library). Follow mode is the feature surfacing this tier; its one-shot ancestors ("Find Compatible", né "Find Related") are retired.

**Follow mode**:
A per-Deck toggle that keeps the browse list continuously filtered to candidate next Tracks for that Deck's loaded Track, updating hands-off as Tracks change — serving "finding the next track painlessly during a set". A followed Track's candidates carry both evidence tiers: heuristic Compatible Tracks unioned with the known tier (Tracks with a saved Transition from it, and Linked Tracks) — a known Track surfaces even when heuristics would exclude it, and "known only" narrows to just that tier. With both Decks following, the two candidate sets union. The followed list is tier-ordered by candidate strength — currently known (internally: favorited Transition, then Linked, then unfavorited Transition; a pair takes its best), same Key, relative Key, one Key up, one Key down, then everything else that passed the filter (tiering provisional); best tier wins across followed Decks, and the view's sort orders within a tier. Follow rides playback: starting a Deck while any Deck follows spreads follow to it and revokes it from any paused following Deck (a paused Deck may only follow while nothing plays); pausing a Deck ends its follow unless it was the only Deck playing — the list survives mid-set silence. Playback never enables Follow from nothing: when no Deck follows, turning it on is the user's act.

### Performance data

**Analysis**:
Automatically determining a property of a Track from its audio — key, BPM, beatgrid, waveform. Manual edits to those properties are orthogonal to Analysis.

**Ground truth corpus**:
The set of Tracks whose key/BPM/Beatgrid values are externally verified, used as the measuring stick for Analysis accuracy: candidate analyzers are scored by agreement with it, not by vibe. Tiered by agreement: *gold* where Engine DJ and Rekordbox concur (headline scoring), *disputed* where they disagree — excluded from scoring until hand verification promotes them. Grid phase is Engine-only (no Rekordbox performance data).

**Deck**:
An independent playback unit: one loaded Track plus its transport state (playhead, playing/paused, Main cue) and pitch. Two Decks exist — Deck A and Deck B — owned by the application, not by any view: a Deck outlives views and keeps playing across them. The library player shows Deck A; the Performance view shows both. Per-Deck sound shaping (trim, EQ, filter, volume) belongs to the Mixer's channel strips, as on hardware.

**Deck color**:
The per-Deck identity color used across every surface: Deck A cyan, Deck B magenta (as established by the Transition editor). Identity only — state colors (green for active/playing, blue for accents) never denote a Deck, and Deck colors never denote a state.

**Mixer**:
The single shared output stage: one channel strip per Deck (trim, 3-band EQ, sweep filter, channel fader), plus crossfader, master volume, and an always-on safety limiter. Mirrors a hardware DJ mixer.

**Audible surface**:
A playback mode's claim on the shared Decks+Mixer — the plain deck-transport semantics of the Performance and library views, or the Transition editor's mix-timeline semantics. Exactly one surface is audible at a time; an arbiter owns which, and a displaced surface's playback pauses rather than coexist. Playback gestures from app-wide inputs (a Controller) route by gesture class — transport, cue, pads, jumps, loops, jog — to the audible surface; a class the surface doesn't register is dropped, mirroring what the keyboard does there. Mixer-state controls and Load are not gesture classes: they belong to the shared Mixer and to the mounted browse view respectively. (Redefined 2026-07-05: formerly a group of playback machinery that could produce sound as a unit — the editor had a private player; every surface now plays through the shared Decks+Mixer.)

**Performance view**:
The two-deck view for practicing and performing mixes: stacked full-width waveforms with linked zoom, symmetric Deck A/B panels, a central Mixer panel, and the Library's browse surface embedded below. Replaces the Practice view. Curation beyond quick edits (tags, provenance) stays in the library view.

**Load**:
Placing a Track on a Deck for playback — an explicit act, as in DJ hardware. Selecting a track in the library browses without loading; the Deck keeps its Track until another Load replaces it. In the Performance view, Loading onto a playing Deck is blocked (protecting the mix); in the library it simply replaces what's playing.

**Nudge**:
A momentary tempo bend on a Deck used to ride phase alignment against the other Deck — held (a key or button) or impulse-driven (jog wheel rotation); when the input stops, the Deck's pitch is restored exactly. Distinct from a *grid nudge*, which shifts a Track's Beatgrid and changes stored data — a Nudge changes only what is playing right now. Jog rotation on a paused Deck is a seek, not a Nudge. The Transition editor's counterpart of the same intent is the Alignment nudge.

**Play guide**:
A derived, view-only marker in the Performance view: one per saved Transition from an outgoing-candidate Track to a paused Track, marking the instant to press play on the paused Deck so the pair rides that Transition's alignment. Shown while one Deck plays (that Deck is the outgoing side) and, since 2026-07-05, while both are paused — then both directions show at once, and starting a Deck prunes to the live direction. Computed from the Transition's alignment and tempo-match ratio and the paused Deck's current playhead (works wherever the incoming Track is cued), projected on the trajectory before the Transition's first Jump event. A missed guide (already behind the playhead) stays visible rather than disappearing. Rendered as a single line spanning both waveforms, labeled with the Transition's name and carrying the incoming (to-be-pressed) Deck's color. Purely visual — never stored, never editable, never enforcing pitch (a pitch mismatch against the Transition's tempo-match is surfaced, not corrected).
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
A per-Deck transport region the playhead wraps in while playing — set by auto-loop (a whole-beat length anchored at the playhead, edges snapped per Quantize), resized live by halve/double (start edge fixed; a shrink that strands the playhead re-enters it at its phase modulo the new length). Beat-domain: lengths are powers of two, 1/8–32 beats (default 4); seconds are a projection through the Beatgrid, so gridless Tracks cannot auto-loop. Deck state like the playhead — survives view switches and surface displacement, cleared by Load. Relative motion (beat jump) translates the region with the playhead; absolute relocation (Hot Cue trigger, cue return, seek) cancels it. Manual loop in/out and slip-behind loop rolls are deferred.
_Avoid_: loop roll (a different, slip-based feature)

**Saved loop**:
Planned concept: a persisted loop region on a Track, Hot-Cue-like (slots, Sync with Engine DJ's loops), from which an Active loop can be armed. Deferred until the Active loop exists.

**Main cue**:
The single repositionable cue position of a Track, moved with the "cue" button while DJing — distinct from Hot Cues by being one slot that moves freely during performance. Persisted with the Track (CDJ memory-cue behavior). When unset, it defaults to the Track's first beat if a Beatgrid exists, else the first non-silent audio.

**Controller**:
A hardware MIDI control surface (e.g. the DJControl Inpulse 300 MK2) driving Decks, Mixer, and library browsing. An alternative input alongside keyboard and pointer — a Controller adds no new capabilities, only physical access to existing actions — plus Feedback on its own lights. Active app-wide, like the Decks it controls, not tied to any view.

**Mapping**:
The device-specific translation from a Controller's physical controls to manadj actions, and of manadj state to the Controller's Feedback addresses. One Mapping per device model; controls with no manadj counterpart are simply absent from it and do nothing.

**Feedback**:
Device-directed output that mirrors existing on-screen state on a Controller's lights (hot cue pads, transport LEDs). Feedback never carries information the screen doesn't already show, and losing it changes nothing about what the app can do.
_Avoid_: LED sync, output mapping

**Cue bus**:
The second audio output alongside the Master bus: what the DJ's headphones play. Fed by per-channel PFL taps (post-EQ/filter, pre-fader, pre-crossfader) blended with an adjustable taste of master. Independently routable to any output device.
_Avoid_: headphone bus, monitor bus

**PFL**:
Pre-fader listen — a per-channel toggle putting that channel on the Cue bus regardless of its fader or the crossfader. Both channels may be on at once.
_Avoid_: headphone cue (as the toggle's name), solo

**Beatgrid**:
The mapping of beat positions across a Track, including tempo changes. Produced by Analysis, edited by hand, or brought in by External Import. A *placeholder grid* merely generated from the Track's BPM is not saved info — it may be replaced without confirmation, unlike an edited or imported grid. When a Beatgrid exists it is the authority on tempo: the Track's BPM is its projection (the grid's dominant tempo), not an independent field, and editing BPM is a grid operation (ADR 0016). A grid may carry an *anchor* — the downbeat the user explicitly marked — which re-tempo operations never move.

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
A place manadj can obtain audio from. SoundCloud (direct download) and Soulseek (peer search) are Suppliers; Soulseek is supply-only — it has no Source Items. A Source Item may be fulfilled through any Supplier; Audio Provenance records which one actually supplied the audio.

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
