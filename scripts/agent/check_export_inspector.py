#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["playwright"]
# ///
"""Browser QA against the explicitly identified fixture server only."""
import argparse
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True)
parser.add_argument('--screenshots', type=Path, default=Path('/tmp/opencode'))
args = parser.parse_args()
url = args.url.rstrip('/') + '/'
args.screenshots.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 1050})
    identity = page.request.get(url + 'fixture/identity')
    assert identity.status == 200 and identity.json() == {'fixture': 'playlist-export-426', 'real_writes': False}, 'Refusing non-fixture server'
    errors, requests, cases = [], [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: requests.append(r.url))

    def scenario(name, context='Playlist in Library'):
        page.goto(url)
        page.get_by_label('Review scenario').select_option(name)
        page.wait_for_timeout(300)
        page.get_by_label('Review context').select_option(context)
        if context == 'Playlist index → Library':
            page.get_by_role('row').filter(has_text='Night Shift').click()
        else:
            page.get_by_role('button', name='Export this playlist', exact=True).click()
        page.get_by_label('Export destination').select_option('rekordbox')
        expect(page.get_by_role('status')).to_have_count(0)
        page.wait_for_timeout(300)

    def submit():
        page.get_by_label('I reviewed the highlighted overwrites, clears, shared tag updates and membership removals.').check()
        page.get_by_role('button', name='Export reviewed changes').click()

    def screenshot(name):
        page.screenshot(path=str(args.screenshots / f'manadj-export-inspector-426-{name}.png'))

    scenario('skips')
    expect(page.get_by_text('CLEAR: Hot cues, Main cue, Energy, Memory cue mirror', exact=True)).to_be_visible()
    expect(page.locator('.pei-member-remove')).to_contain_text('Old entry.flac')
    screenshot('plan')
    submit()
    expect(page.get_by_role('heading', name='Export receipt', exact=True)).to_be_visible()
    expect(page.get_by_text('skipped: Library has no saved grid', exact=True)).to_be_visible()
    screenshot('skips')
    cases.append('visual plan / successful track with skipped field')
    scenario('partial', 'Playlist index → Library')
    submit()
    expect(page.locator('dd').get_by_text('failed: fixture native-file write', exact=True)).to_be_visible()
    cases.append('Sync entry / per-field partial')
    scenario('blocked')
    expect(page.get_by_text('Export blocked:', exact=False)).to_be_visible()
    expect(page.get_by_role('button', name='Export reviewed changes')).to_be_disabled()
    cases.append('record absence blocks execution')
    scenario('unavailable')
    expect(page.get_by_text('Plan unavailable:', exact=False)).to_be_visible()
    expect(page.get_by_role('button', name='Export reviewed changes')).to_be_disabled()
    cases.append('unavailable plan')
    scenario('stale')
    submit()
    expect(page.get_by_text('Source or destination changed.', exact=False)).to_be_visible()
    cases.append('server stale-plan rejection')
    scenario('unknown')
    submit()
    expect(page.get_by_role('heading', name='Outcome unknown', exact=True)).to_be_visible()
    cases.append('lost receipt remains unknown')
    # HTTP200 alone is not evidence that the reviewed export completed.
    for label, receipt in [
        ('empty', {'playlist_name': 'Night Shift', 'results': []}),
        ('non-array', {'playlist_name': 'Night Shift', 'results': {'target': 'rekordbox'}}),
        ('wrong-context', {'playlist_name': 'Another playlist', 'results': []}),
    ]:
        scenario('skips')
        page.route('**/api/sync/export/playlists/execute?*',
                   lambda route, _request, body=receipt: route.fulfill(status=200, json=body))
        submit()
        expect(page.get_by_role('heading', name='Outcome unknown', exact=True)).to_be_visible()
        expect(page.get_by_text('The server did not return a complete receipt.', exact=False)).to_be_visible()
        if label == 'empty':
            screenshot('incomplete-receipt')
        page.unroute('**/api/sync/export/playlists/execute?*')
        cases.append(f'HTTP200 {label} receipt remains unknown')
    scenario('slow')
    submit()
    expect(page.get_by_role('heading', name='Writing to Rekordbox desktop…', exact=True)).to_be_visible()
    expect(page.locator('.pei-footer').get_by_role('button', name='Close', exact=True)).to_be_disabled()
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_be_visible()
    expect(page.get_by_role('heading', name='Export receipt', exact=True)).to_be_visible(timeout=10000)
    cases.append('pending close guard / no false cancellation')
    scenario('skips')
    page.get_by_label('Export scope').select_option('order')
    page.wait_for_timeout(400)
    expect(page.get_by_role('heading', name='Track data ·', exact=False)).to_have_count(0)
    submit()
    expect(page.get_by_role('heading', name='Export receipt', exact=True)).to_be_visible()
    expect(page.locator('.pei-receipt').get_by_text('Hot cues', exact=True)).to_have_count(0)
    cases.append('order-only scope')
    page.goto(url)
    page.get_by_label('Review scenario').select_option('gated')
    expect(page.get_by_title('Settings → Library → Allow external export', exact=True)).to_be_visible()
    cases.append('export-off explanation')
    page.set_viewport_size({'width': 390, 'height': 844})
    scenario('skips')
    screenshot('narrow')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    dialog = page.get_by_role('dialog')
    dialog.locator('.pei-footer').get_by_role('button', name='Close', exact=True).focus()
    page.keyboard.press('Shift+Tab')
    assert page.evaluate('document.querySelector("[role=dialog]").contains(document.activeElement)')
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)
    expect(page.get_by_role('button', name='Export this playlist', exact=True)).to_be_focused()
    cases.append('390px / focus trap / restore')
    assert not errors, errors
    assert not any(':8127' in u or ':8128' in u for u in requests), requests
    print({'cases': cases, 'browser_errors': errors, 'installed_backend_requests': 0})
    browser.close()
