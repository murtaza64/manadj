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

### Curation

**Tag**:
A curated label applied to a Track. Every Tag belongs to exactly one Tag Category. Engine DJ has no tag concept, so on Export, Tags are encoded as generated Engine playlists under the "ManaDJ Tags" super-playlist.
_Avoid_: MyTag (Rekordbox's term — only use when talking about the Rekordbox boundary itself)

**Tag Category**:
A named, ordered, colored grouping of Tags (e.g. Genre, Vibe, Role).

**Genre**:
A Tag Category. A Track's genre means its Tags in this category; the ID3 genre field in the file is untrusted and not the real genre.

**Energy**:
A first-class Track attribute (1–5) expressing intensity. Not a Tag. External libraries encode it differently (e.g. Rekordbox track color, star ratings); those encodings are Sync-boundary details.

**Playlist**:
A hand-curated, ordered list of Tracks. Curated in manadj and Exported to external libraries. Distinct from the generated playlists that encode Tags in Engine DJ.

**Key**:
One of 24 key centers (12 tonics × major/minor) assigned to a Track. OpenKey is the preferred notation for display and discussion; Camelot, musical, and external libraries' notations are conversions from the same canonical value.

**Harmonically compatible**:
The relation between two Keys that mix well together. The basis of harmonic-mixing features (Circle of Fifths, finding tracks to mix into).
_Avoid_: related (too vague — could mean same artist, genre, etc.)

### Performance data

**Analysis**:
Automatically determining a property of a Track from its audio — key, BPM, beatgrid, waveform. Manual edits to those properties are orthogonal to Analysis.

**Hot Cue**:
One of 8 persistent saved positions in a Track, used to jump to during performance.

**Main cue**:
The single dynamic cue position on a deck, moved with the "cue" button while DJing. Typically transient, unlike Hot Cues.

**Beatgrid**:
The mapping of beat positions across a Track, including tempo changes. Produced by Analysis.

**Waveform**:
The 3-band (low/mid/high) rendering of a Track's audio, used by manadj's own player UI. Internal to manadj — never transferred by Sync; each external library renders its own.

### Acquisition

**Source**:
A place audio is acquired from. Unlike an External library, a Source holds no copy of manadj's library state — it supplies new audio and provenance. Either Native or External.

**Native Source**:
A Source manadj is integrated with: it can Refresh Source Items from it and download from it (SoundCloud today). Provenance from a Native Source is recorded automatically with a structured external ID.

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
A record of where a Track's current audio file came from: an origin label (the Source's name, derived from the URL host for External Sources), an optional URL, and when it was acquired. Recorded automatically for Native Source downloads; asserted by the user otherwise. Label-only provenance is allowed for URL-less origins (cd-rip, unknown). Asserted provenance stays editable; recorded provenance is ground truth and cannot be overwritten by an assertion. Replacing a Track's audio replaces its provenance. Distinct from Source Correspondence: a Track can correspond to a SoundCloud track while its audio was bought elsewhere.

### Sync

**External library**:
A library owned by another program (Engine DJ or Rekordbox) that manadj reads from and writes to. Both are live Export targets.

**Sync**:
Colloquially — and in the UI — the broad umbrella for everything that moves tracks or track data in or out of manadj: Export, External Import, Disk Import, and Acquisition. Too broad for code: name modules and operations by the specific term instead.
_Avoid_: generic "sync" in module/function names

**Export**:
A Sync operation that pushes library state out to an external library. The common case; manadj's state wins.
_Avoid_: publish, push

**Import**:
Any operation that brings tracks or track data into manadj. Two kinds: Disk Import and External Import.

**Disk Import**:
New audio files from the tracks directory becoming Tracks: a Scan discovers candidates, accepting a candidate creates a Track.

**External Import**:
A Sync operation that pulls state from an external library into manadj, for the edge case where a track or its data was added or edited downstream first. The counterpart of Export.
_Avoid_: pull, Library Import

**Scan**:
The discovery step of a Disk Import: finding audio files in the tracks directory that are not yet Tracks and proposing them as candidates.

**Match**:
The association between a Track and its counterpart in an external library, established during a Sync operation by file path, falling back to filename. Recomputed each run; not persisted.
