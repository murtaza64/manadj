# Social library sharing within legit-sources

Research note for #490 (direct Murtaza 2026-11-16: "we should explore how to support social library sharing"), under the #487 legit-sources policy. Revised 2026-11-18 after Murtaza's steers: "p2p audio sharing should be possible for free music (if artists have made the free download intention clear), and buying should be supported in the UI too", and "this will require artists to get on board if the project grows, but while user base is small, we should experiment. djs already do share music across USBs etc, being realistic here." Builds on #428 (parent social research), #434/#433 (friend identity and signed exchange, WIP), #452/#427 (own-device sync). Not a committed design; no implementation, accounts, or network deployment proposed here.

## Posture: experiment now, earn artist buy-in as it grows

Murtaza's framing, and it is the right one: the current user base is one or two people, DJs already hand each other music on USB sticks, and a personal project can afford to experiment. The permission tiers below are what make that experiment honest rather than careless: audio only moves when a redistribution permission actually exists, while link-out tiers already cover the realistic USB-stick use case, showing a friend what's worth having and where to get it. If the project grows, the same structure is what artists and labels can be shown: provenance recorded, buy links prominent, free music respected on the artist's own terms. Artist/label onboarding is a growth-phase workstream, not a blocker for anything here.

## The one-line answer

manaDJ moves **curation knowledge** (what to play, how to mix it) and **demand signals** (what to go buy or grab free) between friends. Audio moves peer-to-peer only when a redistribution permission actually exists for that track; everything else resolves to the recipient getting the audio themselves from a legit source: a buy link, or the artist's own free-download page. That extends the Source model's existing doctrine: a Source is where wanted tracks are *discovered*; where audio is obtained is the user's call: manaDJ links out (Beatport search today) and records Audio Provenance.

## Q1: What can friends share that stays legit?

Shareable always (metadata and intent, zero audio):

- **Track identity + metadata**: artist/title/remix/label/BPM/key, enough for Source Correspondence matching and link-out.
- **Playlists**: hand-curated ordered lists; the purest "check out these tracks" unit.
- **Sets**: adjacencies and pins, the strongest discovery artifact a DJ can hand another DJ.
- **Transition / Cameo knowledge**: anchors, duration, tempo-match flag, automation lanes, Jump events. Gated on edition binding (below).
- **Tags and Tag Categories**, Ratings, Favorite marks: taste signal.
- **Provenance pointers**: External Source URLs (Beatport, Bandcamp, artist pages), the legit "where to get it" attached to each item.

Audio: the axis is **redistribution permission, not price**. Three tiers:

- **Tier 1, no known redistribution permission: no audio.** This is the default and covers typical commercial/label releases (standard copyright, no sharing rights granted), but price is not what decides it: a paid track whose artist grants sharing rights is not in this tier, and a free track without sharing rights still is. The shelf carries metadata plus a legit acquisition link; the recipient gets their own copy.
- **Tier 2, artist-intended free downloads: link, don't copy.** When an artist clearly offers a track free (their own site, Bandcamp name-your-price/$0, SoundCloud with downloads enabled), the shelf links the friend to the artist's canonical free-download page instead of transferring the file. Same outcome for the friend, no legal ambiguity, and the artist keeps their channel, consent and download stats. The legal line: a free download grants the *downloader* a copy; it does not by itself grant anyone permission to *redistribute* the file. SoundCloud's Terms of Use say this explicitly: downloads are allowed where the uploader enabled them, but users must not transfer, share or distribute content except within parameters the uploader set (for example, a Creative Commons license they selected). (soundcloud.com/terms-of-use)
- **Tier 3, redistribution permission exists: P2P audio can be on, conditions attached.** What can qualify: a Creative Commons license, public-domain/CC0 material, or an explicit artist statement permitting re-sharing. Two honest qualifications:
  - **CC conditions must actually be satisfied.** All six CC licenses permit verbatim redistribution, but with conditions: attribution (all), non-commercial contexts only (NC variants), no distribution of adaptations (ND variants), share-alike for derivatives (SA variants). Friend-to-friend, unmodified, non-commercial sharing with attribution preserved fits every CC license; a use that turned commercial or a modified file would change the answer for NC/ND/SA. The app should carry the license identifier and attribution with the item and present them to the recipient, not treat "CC" as a blanket yes. (creativecommons.org/cc-licenses)
  - **Evidence is not proof.** manaDJ can record and display the claimed license or statement as provenance evidence, but it cannot verify that whoever applied the license had the authority to grant it (anyone can tag an upload CC). Recipients should see the evidence and its source, not a guarantee.

Still never shared: stems (separately licensed derivative material), session recordings/snippet audio (#425 milestone first, per #428), and anything riding own-device sync (#452/#427): Syncthing membership and paired-device replicas are not a friend-sharing interface.

## Q2: Can social sharing replace the removed acquisition paths as a discovery route?

Yes, and the pipeline already exists. The likes-as-wishlist pattern (#487/#489) generalizes directly:

**A friend becomes a new Source kind.** Received items that match nothing in the local library become Source Items with provenance `friend:<alias>`, each linking out through the existing External Source mechanism. Where SoundCloud likes point at Beatport, a friend shelf can point at the best legit fulfillment per item: Beatport for commercial tracks, the artist's free-download page for Tier 2, or license-evidenced direct acceptance for Tier 3. Refresh → Classification → Source Correspondence → manual link → user-fulfilled acquisition is the same pipeline either way, so the piracy removal (#488/#489) loses its "but how do I find music now" gap without manaDJ touching unauthorized audio.

A friend Source is also *better* demand signal than a like button:

- A SoundCloud like says "I marked this." A friend's Set says "I actually played B after A at peak time." Set adjacencies, endorsed (favorited) Transitions, and observed play counts are evidence tiers SoundCloud cannot supply.
- Follow's Known > Observed > Compatible model has a natural seat for this, with one hard boundary already set by #434: friend evidence must NOT enter personal Known/Observed/Compatible/Familiarity indexes. So the recommendation is a visibly separate, friend-attributed surface (the #434 direction is a distinct friend semantic token and icon in the Follow target column), never a silent merge into personal evidence. #428's rule stands alongside: social signals carry explicit rationale and source, and personal musical evidence keeps ranking authority.

Honest caveat: friend discovery needs friends who actually use manaDJ. One-way receive still works (any exported shelf is useful to the recipient), but the network effect is cold-started. Link-out keeps every received item actionable regardless.

## Buying in the UI (new, from the 2026-11-18 steer)

Today manaDJ links out to a Beatport *search* and stops. A real purchase path can go further without pretending to be a store. Verified versus unverified, kept separate:

- **Verified buildable now, no partnerships needed**: direct track/release links wherever a Beatport ID is known (the External Source model already stores them); an in-app **buy list** that collects wishlist items you intend to purchase (the wishlist already knows what you want; the buy list is its checkout queue); one-tap handoff to Beatport, in an in-app browser sheet so the purchase flow never loses context; and purchase recording back into Audio Provenance (user-asserted today, file-hint detection at Disk Import already exists). Bandcamp works the same way via artist-page links.
- **Verified to exist, gated**: a Beatport Group affiliate program is publicly available (link-based attribution with commission: pluginboutique.postaffiliatepro.com/affiliates), and Beatport runs a developer portal and partner portal with integration guidelines and SDKs (api.beatport.com/v4/docs, partnerportal.beatport.com), both behind login/approval. Terms, eligibility and what the SDKs actually allow are unknown until applied.
- **Unverified, partnership-dependent**: native in-app checkout. No public Beatport purchase API turned up in this research, but that does not prove none exists behind a partnership; whether Beatport offers commerce integration to partners is exactly what an application would answer. Recommendation: don't design against an assumed checkout API; design the buy list + handoff so it stands alone, and treat any deeper integration as an upgrade if a partnership materializes.

Recommendation: spec the buy list + direct links + provenance recording as the first slice (pure UI on existing domain machinery), and file the affiliate/developer-portal application as a parallel research action.

## Q3: Scope, consent, and what the envelope actually guarantees

Consistent with #428 and what #434 is already building:

- **Opt-in per friend**: pinned friend identities (#434's local crypto identity + explicitly pinned aliases). A friend is never an own-machine Paired device; Device sync tokens, whole-library snapshots and Syncthing membership are never friend grants.
- **Explicit per-share acts**, not standing feeds: the sender exports a specific Playlist/Set/selection. No ambient "friends can always browse my library" in v0.
- **What "signed, recipient-bound" does and does not guarantee** (verified against #434's spec): the signature proves the envelope came from a pinned friend identity, not a self-asserted display name, and the envelope names its intended recipient, which import validates (forged audience is a reject case in #434's verification list). It is a metadata JSON file: nothing in #434's spec encrypts the contents, so anyone holding the file can read what's inside. Treat a share as readable, not secret. The envelope's job is authenticity and audience-checking at import, not confidentiality. (If Tier 3 audio ever rides the envelope, encrypting the payload to the recipient's pinned key becomes worth adding; metadata alone doesn't justify it.)
- **Revocation, honestly**: #434's own model is durable offer/request/grant/revoke states where revocation stops future authorized access when observed. Already-received files and deliberately saved local copies cannot be remotely erased, and nothing can stop someone manually forwarding the file itself. The controls are import-side (identity, audience, revocation checks on new imports) and local UI (removing the friend and their shelf), not erasure or cryptographic prevention of copies that already left.
- **No transitive sharing by default**: v0 offers no re-export of a received shelf with the original friend's attribution. Attribution travels with the item; forwarding is a deliberate later decision, and per above it can never be technically prevented, only unsupported. Tier 3 audio adds a license dimension: onward sharing is only ever *supported* for items whose recorded permission allows it, with the same CC conditions and evidence-not-proof caveats applied again.

## Q4: Smallest end-to-end slice

**Friend shelf via envelope.** One export, one import, no infrastructure:

1. Sender picks a Playlist (or current track selection) → manaDJ writes a signed, recipient-bound, metadata-only envelope (#434 format: Track identities + metadata + Play order + provenance pointers).
2. File travels over any existing channel (AirDrop, iMessage, email).
3. Recipient's manaDJ imports it as a Friend Source plus a read-only "friend shelf" view.
4. Every item resolves: Source Correspondence matches a local Track (shelf annotates your own copy, friend's Tags/Ratings visible against it); no match → Source Item in the wishlist, with the best legit fulfillment attached (Beatport buy link, artist free-download page, or Tier 3 permission evidence).

The audio tiers don't delay this: the shelf ships metadata-only, and Tier 2/3 fulfillment is link-out at first. Actual Tier 3 audio transfer is a later envelope extension once the permission-evidence UX exists.

Deliberately excluded from the slice, each with a follow-up path:

- **Executable Transition/Cameo transfer**: anchors are seconds against a specific audio edition. #434 already settles the binding mechanism, validated SHA-256 of the exact audio file bytes, rejecting unknown/tampered/mismatched dependencies, with personal Track IDs never crossing the wire. What remains open is the cross-edition fallback: when the bytes don't match, import as a *transition idea* (pair + text-level intent) rather than an artifact that would play wrong.
- **Live B2B**: #428's analysis axis (Link tempo sync is not audio transport); nothing near-term.
- **Snippet/clip sharing**: after #425 recording/native-share, reusing the clip editor/visualizer work.
- **Re-sharing, feeds, standing browse**: no generic social surface without evidence.

## Recommendation

Proceed with the Friend shelf slice as the v0 of #490's exploration, specced as its own ready-for-agent issue **once #434's envelope and friend identity land** (currently WIP; the slice should consume that format, not invent a second one). In parallel, spec the buying-UI slice (buy list + direct links + provenance recording) since it needs no partnership and serves the whole wishlist, not just friend shares. File the Beatport affiliate/developer-portal application as a research follow-up. Desktop-first; Android import follows #433's port of the same envelope. The friend-attributed discovery surface in Follow is a later slice after the shelf proves useful in real use.

## Telemetry (tracked, from the 2026-11-18 steer)

Murtaza asked to "track some secure and private telemetry work too that would help us improve the project." No such ticket exists in the tracker today (searched; nearest is #439 crash diagnostics, owned by another lane), so this records the proposed work as a backlog draft. This is design preparation, not approval to collect or transmit anything.

Proposed ticket draft (house style, for his review before filing):

- **Title**: telemetry: privacy-first usage insight for product decisions
- **Problem**: roadmap calls are made on vibes. Which features earn their place (Follow picks actually taken, exports actually run, deck time, tutorial completion) is unknown, and adding analytics the usual way would betray the project's personal, local-first character.
- **Design constraints**: local-first aggregate counters, not event streams; opt-in with a visible toggle; no audio, library contents, track titles or friend data ever collected; nothing transmitted without an explicit per-purpose consent; everything inspectable in-app before it leaves; deletion wipes local history. Any future sharing is aggregate-only and minimal (think "7 sessions this week, Follow acceptance rate 0.4"), and self-hosted or no backend at all in v0.
- **Acceptance**: a written threat model and data inventory (what is collected, where it lives, what is never collected); a local stats surface showing the user their own aggregates; the toggle defaults off; no network code in v0.
- **Direct Murtaza 2026-11-18.** Port: now, desktop first; Android counterpart states its own decision.

## Open decisions

- Tier 3 evidence UX: how permission evidence (CC declaration, artist statement) is captured at share time, displayed to the recipient with its source, and preserved on onward shares. Includes how the app presents "evidence, not proof" honestly.
- Whether Tier 3 audio in envelopes justifies recipient-key encryption (metadata alone doesn't).
- Cross-edition Transition fallback UX: exact-byte binding rejects, then what: "idea" import, request-the-right-edition flow, or nothing.
- Buy list behavior: cart-like batching vs per-item handoff, and how purchase confirmation is detected vs asserted.
- Beatport affiliate/developer access: eligibility and terms for a personal project; unknown until applied.
- Friend attribution display in the wishlist (recommend: always attributed; it is the discovery story) and exact Follow surface within #434's separation rule.
- Keep-or-drop choice for a removed friend's already-imported items (local state, user's call; Refresh semantics already never delete).
- Definition of "free music" (#487's open decision) now has a proposed shape: the permission tiers above, with redistribution permission (not price) as the line for audio transfer.
- Whether a Friend Source can ever be Native (auto-refresh from a friend's published shelf): deferred; standing feeds are out of v0.

## Sources

- Issues: #487/#488/#489 (legit-sources policy, piracy removal, likes-as-wishlist), #428 (parent social research scope and constraints), #434/#433 (friend identity + signed envelope spec and WIP checkpoint, including its signature/audience/revocation/SHA-256-binding guarantees), #452/#427 (own-device sync, explicitly not friend sharing), #425 (recording/native-share milestone).
- Murtaza, iMessage 2026-11-18: P2P audio should be possible for clearly-intended free music; buying should be supported in the UI; experiment while the user base is small (DJs already share over USBs), artist onboarding is a growth-phase concern; track secure/private telemetry work as design prep.
- CONTEXT.md: Source / Native Source / External Source, Source Item, Wishlist pipeline (Refresh, Classification, Source Correspondence, fulfillment by Beatport link-out), Audio Provenance, Follow mode (Known > Observed > Compatible), Transition/Cameo, Set, Playlist, Linked.
- Creative Commons license overview (all six licenses permit verbatim redistribution with attribution; NC restricts commercial use, ND restricts adaptations, SA requires share-alike on derivatives): https://creativecommons.org/cc-licenses/
- SoundCloud Terms of Use (downloads only where the uploader enabled them; no transfer/sharing/distribution of content except within uploader-set parameters such as a selected CC license): https://soundcloud.com/terms-of-use
- Beatport commerce surface: developer portal https://api.beatport.com/v4/docs/ and partner portal https://partnerportal.beatport.com/hc/en-us (both gated); Beatport Group affiliate program (public, link-based): https://pluginboutique.postaffiliatepro.com/affiliates/
- Repo state checked 2026-11-18: #434 backend checkpoint WIP (signed envelope staging + 43 targeted tests passing, per its issue); no Spotify integration exists (pattern-only per #487).
