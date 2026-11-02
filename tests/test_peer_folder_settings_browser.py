"""Actual full-app Settings -> production APIs -> independent folder delivery."""
from pathlib import Path
from contextlib import ExitStack
import shutil

import httpx
import pytest

from backend.peer_sync.folder import FolderTransport
from tests import test_peer_session_exchange as exchange
from tests.peer_folder_app import fixture_app, generated_audio, replay_frontend, serving
from tests.test_peer_folder_transport import artifact, copy_artifacts
from tests.test_peer_history_integration import history
from tests.test_peer_session_exchange import setup_pair


@pytest.fixture
def instance(tmp_path):
    yield from exchange.instance.__wrapped__(tmp_path)


def test_full_settings_configure_accept_select_bind_partial_restart_archive_rotate(instance, tmp_path):
    browser_api = pytest.importorskip('playwright.sync_api')
    shells = sorted((Path.home() / '.cache/ms-playwright').glob('chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell'))
    if not shells or not (Path(__file__).parents[1] / 'frontend/dist/index.html').exists():
        pytest.skip('Build frontend and install Playwright Chromium first')
    a, b, ai, bi, sid = setup_pair(instance)
    generated_audio(a, b)
    ra, rb = a.root / 'exchange', b.root / 'exchange'
    ra.mkdir()
    rb.mkdir()
    ta, tb = FolderTransport(a.sessions), FolderTransport(b.sessions)
    with ExitStack() as receiver_server, serving(fixture_app(a)) as ua, browser_api.sync_playwright() as p:
        ub = receiver_server.enter_context(serving(fixture_app(b)))
        browser = p.chromium.launch(executable_path=str(shells[-1]), headless=True, args=['--autoplay-policy=no-user-gesture-required'])
        sender, receiver = browser.new_page(), browser.new_page()
        for page, url, root, replica in [(sender, ua, ra, bi['replica_id']), (receiver, ub, rb, ai['replica_id'])]:
            page.goto(url + '/?settings=1&section=session-exchange')
            panel = page.get_by_role('region', name='Session exchange', exact=True)
            panel.get_by_label('Existing absolute folder path').fill(str(root))
            panel.get_by_role('button', name='Authorize and enable folder').click()
            panel.get_by_text('Active folder:', exact=False).wait_for()
            panel.get_by_label('Replica UUID', exact=True).fill(replica)
            panel.get_by_label('Replica label', exact=True).fill('Explicit generated peer')
            panel.get_by_role('button', name='Accept namespace').click()
            panel.get_by_text('Explicit generated peer', exact=False).wait_for()
        source_panel = sender.get_by_role('region', name='Session exchange', exact=True)
        target_panel = receiver.get_by_role('region', name='Session exchange', exact=True)
        source_panel.get_by_label('Local Session', exact=True).select_option(sid)
        with sender.expect_response(lambda r: f'/transport/selections/{sid}' in r.url and r.request.method == 'POST') as selected:
            source_panel.get_by_role('button', name='Publish selected Session').click()
        assert selected.value.status == 200, selected.value.text()
        ta.run_once()
        source = artifact(ra)
        target = rb / source.name
        target.mkdir()
        for name in ('manifest.json', 'complete.json'):
            shutil.copy2(source / name, target)
        assert tb.run_once()['receipts'][0]['state'] == 'partial'
        target_panel.get_by_role('button', name='Refresh health').click()
        target_panel.get_by_role('listitem').filter(has_text=source.name).filter(has_text='partial').wait_for()
        assert history(b).get('/api/sessions').json() == []
        receiver_server.close()
        b = instance('b')  # New engine AND application/listener before retry.
        tb = FolderTransport(b.sessions)
        ub = receiver_server.enter_context(serving(fixture_app(b)))
        receiver.goto(ub + '/?settings=1&section=session-exchange')
        copy_artifacts(ra, rb)
        assert tb.run_once()['receipts'][0]['readiness'] == 'unresolved_references'
        target_panel.get_by_role('button', name='Refresh health').click()
        target_panel.get_by_role('button', name='Inspect dependencies').click()
        target_panel.get_by_label('Local Track ID', exact=False).fill('9')
        with receiver.expect_response(lambda r: '/tracks/9/bind' in r.url) as bound:
            target_panel.get_by_role('button', name='Bind selected local Track').click()
        assert bound.value.status == 200, bound.value.text()
        assert tb.run_once()['receipts'][0]['readiness'] == 'materialized'
        assert history(b).get(f'/api/sessions/{sid}').json()['events'][0]['trackId'] == 9
        with replay_frontend(ub, tmp_path) as proof_url:
            proof = browser.new_page()
            proof.goto(proof_url)
            proof.wait_for_function('!!window.peerProof')
            signal = proof.evaluate('sid => window.peerProof.start(sid)', sid)
            assert signal['track'] == 9 and signal['state'] == 'ready', signal
            assert signal['playing'] and signal['playhead'] > .05 and signal['level'] > 0, signal
            assert signal['generation'] and signal['stopped'] is None
            (b.root / 'generated.wav').unlink()  # Generated decoy; cached playback must refuse.
            assert proof.evaluate('() => window.peerProof.resume()') == {'playing': False, 'stopped': 'load-failed'}
            generated_audio(b)
            proof.close()
        copy_artifacts(rb, ra)
        assert ta.run_once()['publications'][0]['state'] == 'acknowledged'
        source_panel.get_by_role('button', name='Disable exchange', exact=True).click()
        source_panel.get_by_role('checkbox', name='Retain all files', exact=False).check()
        source_panel.get_by_role('button', name='Archive and retain all files', exact=True).click()
        source_panel.get_by_text('Archived; not scanned', exact=False).wait_for()
        fresh = a.root / 'fresh'
        fresh.mkdir()
        source_panel.get_by_label('Existing absolute folder path').fill(str(fresh))
        with sender.expect_response(lambda r: r.url.endswith('/transport') and r.request.method == 'POST') as rotated:
            source_panel.get_by_role('button', name='Authorize and enable folder').click()
        assert rotated.value.status == 200
        assert ta.run_once()['publications'] == []
        assert source.exists() and target.exists()
        # Origin and cross-site guards are exercised on the actual listener.
        assert httpx.post(ua + '/api/peer-sync/transport/archive', json={}, headers={'Origin': 'https://remote.invalid'}).status_code == 403
        assert httpx.post(ua + '/api/peer-sync/transport', json={}, headers={'Sec-Fetch-Site': 'cross-site'}).status_code == 403
        sender.screenshot(path=str(tmp_path / 'full-app-root-rotation.png'), full_page=True)
        receiver.screenshot(path=str(tmp_path / 'full-app-receiver-binding.png'), full_page=True)
        browser.close()
