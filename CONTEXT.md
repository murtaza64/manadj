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
A first-class persisted artifact: the handover between an ordered pair of Tracks — entry/exit anchors (in seconds), a duration, an optional tempo-match, and drawn automation lanes for mixer controls. Directional (A→B is not B→A); a pair usually has one Transition, occasionally several. The incoming entry anchor may be negative: the incoming Track's audio then begins partway into the Transition (a silent lead gap). Beat-snapping and tempo-matching are editing affordances, not the model. The accumulating set of saved Transitions is the library of "what mixes well into what" — the seed of track-association features.

**Sketch origin**:
The Transition editor's timeline starts at the outgoing Track's start — an invariant, not a setting. The outgoing Track never moves on the timeline; every alignment gesture is expressible as a Slide of the incoming Track, the window, or both.

**Transition editor**:
The top-panel mode (a sibling of the library and Performance views) for editing the saved Transition between two loaded Tracks on a DAW-style timeline. Entering it pauses other playback surfaces: one audible surface at a time.

**Mix**:
Future concept: an ordered sequence of Tracks whose adjacencies reference saved Transitions. Deferred until the Transition library exists. Distinct from a Playlist, and from the Classification value "mix" (an externally recorded DJ mix on a Source).

**Favorite**:
A boolean on a Transition marking a proven move — asserting both "these Tracks go well together" and "this specific Transition is good." The unit discovery ranks by. Distinct from a Track's Rating.
_Avoid_: like (social-app connotation).

**Preferred pair**:
A derived, never-stored property: an ordered Track pair with at least one favorited Transition. Surfaces as the starred variant of Transition-library marks. Bookmarking a pairing with no sketched Transition is deliberately NOT this — that would be a worklist concept, not a Favorite variant.

**Transition library**:
The queryable index over saved Transitions — "what mixes out of / into this Track" — surfaced as library-row marks and discovery filters. Directional, like the Transitions it indexes.

**Transition template**:
A named beat-domain recipe for producing a Transition: per-side anchor rules (an anchor base — a cue slot or the Grid origin — plus a whole-beat delta on each track's own grid), a length in beats (fixed or scalable at apply time), and normalized automation lanes (e.g. "bass swap") — only lanes the author gave meaningful content; hidden and untouched lanes are not part of the recipe. Applying one translates beats to seconds via the tempo-matched beatgrids and yields an ordinary seconds-based Transition — the recipe is an editing affordance, not a runtime concept. Application never guesses alignment: an anchor that cannot be resolved leaves anchors untouched, while the rest of the recipe still stamps.

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
A heuristic relation between Tracks: key, tempo, energy, and tag agreement suggest they would mix well. One of discovery's two evidence tiers — heuristics propose, the Transition library confirms (proven, Favorite-ranked). "Find Compatible" is the feature surfacing this tier (renamed from "Find Related", which the glossary forbids).

### Performance data

**Analysis**:
Automatically determining a property of a Track from its audio — key, BPM, beatgrid, waveform. Manual edits to those properties are orthogonal to Analysis.

**Deck**:
An independent playback unit: one loaded Track plus its transport state (playhead, playing/paused, Main cue) and pitch. Two Decks exist — Deck A and Deck B — owned by the application, not by any view: a Deck outlives views and keeps playing across them. The library player shows Deck A; the Performance view shows both. Per-Deck sound shaping (trim, EQ, filter, volume) belongs to the Mixer's channel strips, as on hardware.

**Mixer**:
The single shared output stage: one channel strip per Deck (trim, 3-band EQ, sweep filter, channel fader), plus crossfader, master volume, and an always-on safety limiter. Mirrors a hardware DJ mixer.

**Audible surface**:
A group of playback machinery that can produce sound as a unit — the shared Decks+Mixer, or the Transition editor's private player. Exactly one is audible at a time (one running audio clock); an arbiter owns which, and displaced surfaces go silent rather than coexist. Transport gestures from app-wide inputs (a Controller) route to whichever surface is audible; a gesture the surface has no meaning for is dropped, mirroring what the keyboard does there.

**Performance view**:
The two-deck view for practicing and performing mixes: stacked full-width waveforms with linked zoom, symmetric Deck A/B panels, a central Mixer panel, and the Library's browse surface embedded below. Replaces the Practice view. Curation beyond quick edits (tags, provenance) stays in the library view.

**Load**:
Placing a Track on a Deck for playback — an explicit act, as in DJ hardware. Selecting a track in the library browses without loading; the Deck keeps its Track until another Load replaces it. In the Performance view, Loading onto a playing Deck is blocked (protecting the mix); in the library it simply replaces what's playing.

**Nudge**:
A momentary tempo bend on a Deck used to ride phase alignment against the other Deck — held (a key or button) or impulse-driven (jog wheel rotation); when the input stops, the Deck's pitch is restored exactly. Distinct from a *grid nudge*, which shifts a Track's Beatgrid and changes stored data — a Nudge changes only what is playing right now. Jog rotation on a paused Deck is a seek, not a Nudge.

**Hot Cue**:
One of 8 persistent saved positions in a Track, used to jump to during performance.

**Main cue**:
The single repositionable cue position of a Track, moved with the "cue" button while DJing — distinct from Hot Cues by being one slot that moves freely during performance. Persisted with the Track (CDJ memory-cue behavior). When unset, it defaults to the Track's first beat if a Beatgrid exists, else the first non-silent audio.

**Controller**:
A hardware MIDI control surface (e.g. the DJControl Inpulse 300 MK2) driving Decks, Mixer, and library browsing. An alternative input alongside keyboard and pointer — a Controller adds no new capabilities, only physical access to existing actions. Active app-wide, like the Decks it controls, not tied to any view.

**Mapping**:
The device-specific translation from a Controller's physical controls to manadj actions. One Mapping per device model; controls with no manadj counterpart are simply absent from it and do nothing.

**Beatgrid**:
The mapping of beat positions across a Track, including tempo changes. Produced by Analysis, edited by hand, or brought in by External Import. A *placeholder grid* merely generated from the Track's BPM is not saved info — it may be replaced without confirmation, unlike an edited or imported grid.

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
A place a track can exist: Disk (a file in the tracks directory), Library (a manadj Track), Engine DJ, or Rekordbox. The unified sync view shows one row per track matched across Surfaces; row identity comes from Match, so it inherits Match's limits (a renamed file appears as two rows until a Link concept exists).

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
