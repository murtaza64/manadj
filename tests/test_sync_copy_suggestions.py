from types import SimpleNamespace as Row
from backend.sync_common.suggestions import suggest_copies


def track(id=1, title='Ascension (Original Mix)', duration=240, artist='Artist'):
    return Row(id=id, title=title, artist=artist, filename=f'{id}.mp3', duration_secs=duration)


def entry(title='001 Ascension (Original Mix)', duration=240, status='new'):
    return Row(ordinal=0, title=title, artist='Artist', duration_secs=duration, status=status)


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
