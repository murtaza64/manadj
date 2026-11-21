from types import SimpleNamespace as Row
from backend.sync_common.suggestions import suggest_copies


def track(id=1, title='Ascension (Original Mix)', duration=240, artist='Artist'):
    return Row(id=id, title=title, artist=artist, filename=f'{id}.mp3', duration_secs=duration)


def entry(title='001 Ascension (Original Mix)', duration=240, status='new', artist='Artist'):
    return Row(ordinal=0, title=title, artist=artist, duration_secs=duration, status=status)


def test_numbered_alternate_copy_is_suggestion_not_identity():
    e = entry()
    result = suggest_copies([e], [track()])
    assert result[0][0]['track_id'] == 1
    assert 'unverified' in result[0][0]['evidence']
    assert e.status == 'new'


def test_conflicting_versions_duration_and_missing_evidence_withheld():
    assert not suggest_copies([entry()], [track(title='Ascension (Aries Remix)')])
    assert not suggest_copies([entry()], [track(duration=60)])
    assert not suggest_copies([entry(duration=None)], [track()])
    assert not suggest_copies([entry(status='present')], [track()])


def test_ties_kept_and_bounded_without_auto_accept():
    result = suggest_copies([entry()], [track(id=i) for i in range(1, 7)])
    assert [x['track_id'] for x in result[0]] == [1, 2, 3]
    assert all(x['duration'] == 'exact' for x in result[0])


def test_same_title_wrong_artist_and_explicit_mix_suffix_are_withheld():
    assert not suggest_copies([entry()], [track(artist='Unrelated person')])
    assert not suggest_copies([entry(title='Ascension - Aries Remix')], [track(title='Ascension - Original Mix')])


def test_shared_collaborator_is_suggested_despite_different_credit():
    # The USB credits more artists than the library copy (or vice versa).
    e = entry(artist='Kanine, Andromedik')
    assert suggest_copies([e], [track(artist='Kanine')])
    assert suggest_copies([entry(artist='Kanine')], [track(artist='Kanine & Andromedik')])
    # Reordered credit.
    assert suggest_copies([e], [track(artist='Andromedik, Kanine')])


def test_bare_library_title_matches_versioned_entry():
    # The library copy dropped the version qualifier entirely.
    e = entry(title='002 Touchdown (Original Mix)', artist='Mila Falls, Kanine, Sona')
    assert suggest_copies([e], [track(title='Touchdown', artist='Kanine', duration=240)])
    # Same in the other direction: bare entry, versioned library title.
    assert suggest_copies([entry(title='003 Touchdown')], [track(title='Touchdown (Original Mix)')])


def test_unrelated_parenthetical_stays_part_of_the_title():
    # Only version qualifiers fall out of the core title; a live recording is
    # the copy's identity, not noise. (The full-title fuzzy path already
    # scores near-identical titles like Part 1/Part 2 above threshold on its
    # own - that pre-existing behavior is out of scope here.)
    assert not suggest_copies([entry(title='009 Horizon')], [track(title='Horizon (Live at Printworks)')])


def test_generic_artist_credit_does_not_block():
    assert suggest_copies([entry(artist='Various Artists')], [track(artist='Kanine')])


def test_collabs_sharing_no_artist_are_withheld():
    e = entry(artist='Kanine, Andromedik')
    assert not suggest_copies([e], [track(artist='Mila Falls, Sona')])
