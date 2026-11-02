#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["playwright"]
# ///
"""Actual App/Sync browser proof; refuses anything but the disposable fixture."""
import argparse
import re
from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True)
parser.add_argument('--artifacts-prefix', default='/tmp/opencode/manadj-sync442')
args = parser.parse_args()
url = args.url.rstrip('/')
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 1500, 'height': 1000})
    # Headless MIDI permission is denied. Its existing boot recovery otherwise
    # reloads the whole App after3s, racing captured selection/receipts. Seed
    # only that recovery flag; do not grant devices or mock adapter success.
    page.add_init_script("sessionStorage.setItem('manadj-midi-boot-reloaded', '1')")
    identity = page.request.get(url + '/fixture/identity').json()
    assert identity['fixture'] == 'library-export-442' and not identity['installed_app']
    assert identity['engine_identity_fixture']
    errors, cases, http_errors = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: http_errors.append((response.status, response.url)) if response.status >= 400 else None)
    page.goto(url + '/?view=sync')
    sw = page.locator('.sync-workspace:visible')
    expect(sw.get_by_role('heading', name='Sync workspace', exact=True)).to_be_visible()
    expect(sw.get_by_role('button', name='USB · unavailable')).to_be_disabled()
    expect(sw.locator('[data-track-id="1"]')).to_be_visible()

    def row(ident):
        return sw.locator(f'[data-track-id="{ident}"]')

    def recheck():
        sw.get_by_role('button', name='Recheck plan', exact=True).click()
        expect(sw.get_by_text('tracks · IDs', exact=False)).to_be_visible()

    def fields_only_key():
        for field in ['hotcues', 'maincue']:
            sw.get_by_label(field, exact=True).uncheck()

    sw.get_by_label('Review scope', exact=True).select_option('all')
    recheck()
    expect(sw.get_by_text('4 tracks · IDs 1, 2, 3, 4', exact=False)).to_be_visible()
    expect(sw.get_by_role('button', name='Apply ', exact=False)).to_be_disabled()
    sw.get_by_label('Filter workspace tracks').fill('Neon')
    sw.get_by_label('Review scope', exact=True).select_option('filtered')
    recheck()
    expect(sw.get_by_text('1 tracks · IDs 1', exact=False)).to_be_visible()
    cases.append('complete all/filtered scopes; missing records block field-only writes')
    sw.get_by_label('Filter workspace tracks').fill('')
    row(1).click()
    fields_only_key()
    with page.expect_response(lambda response: response.url.endswith('/api/sync/fields/plan')) as observed:
        recheck()
    planned = observed.value.json()
    assert planned['track_ids'] == [1] and planned['tracks'][0]['fields'][0]['before'] == 1
    expect(sw.get_by_role('group', name='Key change').locator('.pei-value-before')).to_contain_text('1m')
    sw.get_by_label('Replace saved key for Neon Current', exact=True).check()
    page.screenshot(path=args.artifacts_prefix + '-engine-before.png')
    # Hold the real execute request, without replacing its response or writer.
    held = []
    page.route('**/api/sync/fields/execute', lambda route: held.append(route))
    sw.get_by_role('button', name='Apply 1 fields', exact=True).click()
    expect(sw.get_by_role('button', name='Rekordbox desktop')).to_be_disabled()
    expect(page.locator('.sync-view-tab').first).to_be_disabled()
    expect(sw.get_by_label('Filter workspace tracks')).to_be_disabled()
    expect(sw.locator('[data-review-panel]')).to_be_focused()
    assert len(held) == 1
    page.locator('.topbar-segment-overflow').click()
    page.get_by_role('menuitem', name='EXPORT', exact=False).click()
    expect(sw).not_to_be_visible()
    page.locator('.topbar-mode-control').get_by_title('Sync', exact=True).click()
    expect(sw.get_by_role('button', name='Rekordbox desktop')).to_be_disabled()
    held.pop().continue_()
    expect(sw.get_by_role('heading', name='Field receipt', exact=True)).to_be_visible()
    page.unroute('**/api/sync/fields/execute')
    evidence = page.request.get(url + '/fixture/evidence').json()
    assert [item['key'] for item in evidence['engine']] == [7, 7]
    assert any('Engine Library-snapshots' in name for name in evidence['backups'])
    cases.append('Engine exact same-basename identity; consent, real write/backup/receipt; pending locks/focus')

    sw.get_by_role('button', name='Rekordbox desktop').click()
    expect(sw.get_by_role('button', name='Apply 0 fields')).to_be_disabled()
    for field in ['hotcues', 'maincue']:
        sw.get_by_label(field, exact=True).check()
    recheck()
    sw.get_by_label('Replace saved hotcues for Neon Current', exact=True).check()
    sw.get_by_label('Replace saved maincue for Neon Current', exact=True).check()
    sw.get_by_role('button', name='Apply ', exact=False).click()
    expect(sw.get_by_role('heading', name='Field receipt', exact=True)).to_be_visible()
    evidence = page.request.get(url + '/fixture/evidence').json()
    assert len(evidence['native']['share/1/ANLZ0000.EXT']) == 3
    assert evidence['backups']
    cases.append('RB real cue/Main DB/native DAT/EXT and backup proof; target resets consent')

    row(3).click()
    recheck()
    expect(sw.get_by_role('button', name='Apply ', exact=False)).to_be_disabled()
    expect(sw).to_contain_text('Record absent or ambiguous downstream')
    sw.get_by_label('Review operation').select_option('playlist')
    sw.get_by_label('Library playlist', exact=True).select_option('Integration Set')
    expect(sw.get_by_text('ADD DESTINATION RECORD', exact=True)).to_be_visible()
    expect(sw.get_by_text('UNAVAILABLE · omitted', exact=True)).to_be_visible()
    sw.locator('.pei-confirm input').check()
    sw.get_by_role('button', name='Export reviewed changes', exact=True).click()
    expect(sw.get_by_role('heading', name='Export receipt', exact=True)).to_be_visible()
    expect(sw.get_by_text('Added 1 destination library record', exact=False)).to_be_visible()
    expect(sw.get_by_text('Cue DB committed; native DAT/EXT not synchronized', exact=False).first).to_be_visible()
    assert page.request.get(url + '/fixture/evidence').json()['records'] == 3
    page.screenshot(path=args.artifacts_prefix + '-playlist-receipt.png')
    cases.append('separate playlist creates destination; unavailable/no-ANLZ remain partial, not native success')
    sw.get_by_label('Review operation').select_option('fields')
    row(3).click()
    fields_only_key()
    recheck()
    expect(sw.get_by_text('Record absent or ambiguous downstream', exact=False)).to_have_count(0)
    cases.append('field replan observes separately created record')

    row(1).focus()
    row(1).press('ArrowDown')
    expect(row(2)).to_be_focused()
    expect(sw.get_by_label('Review scope', exact=True)).to_have_value('selected')
    row(2).press('Space')
    sw.get_by_role('button', name='Recheck plan', exact=True).click()
    expect(sw).to_contain_text('No tracks in this scope')
    cases.append('keyboard exact-row navigation and empty selection fails closed')
    page.set_viewport_size({'width': 390, 'height': 844})
    row(1).click()
    recheck()
    sw.get_by_role('button', name='Recheck plan', exact=True).scroll_into_view_if_needed()
    page.screenshot(path=args.artifacts_prefix + '-mobile.png')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'page-wide mobile overflow'
    cases.append('390px full-App workspace scroll and review controls')
    page.set_viewport_size({'width': 1500, 'height': 1000})
    page.screenshot(path=args.artifacts_prefix + '-desktop.png')

    request = {'track_ids': [1], 'scope': 'selected', 'surface': 'rekordbox', 'direction': 'export', 'fields': ['hotcues']}
    stale = page.request.post(url + '/api/sync/fields/plan', data=request).json()
    before = page.request.get(url + '/fixture/evidence').json()['cue_rows']
    assert page.request.post(url + '/fixture/gate', params={'enabled': 'false'}).status == 200
    assert page.request.post(url + '/api/sync/fields/execute', data={**request, 'token': stale['token'], 'replacements': []}).status == 403
    assert page.request.post(url + '/fixture/gate', params={'enabled': 'true'}).status == 200
    page.request.post(url + '/fixture/remove-ext')
    assert page.request.post(url + '/api/sync/fields/execute', data={**request, 'token': stale['token'], 'replacements': []}).status == 409
    assert page.request.get(url + '/fixture/evidence').json()['cue_rows'] == before
    cases.append('real gate and native freshness reject before dispatch')

    # A transport failure is injected, not a fabricated plan/write success.
    sw.get_by_role('button', name='Engine DJ', exact=True).click()
    row(2).click()
    recheck()
    sw.get_by_label('Replace saved key for Signal Loop', exact=True).check()
    page.route('**/api/sync/fields/execute', lambda route: route.abort('failed'))
    sw.get_by_role('button', name='Apply 1 fields', exact=True).click()
    expect(sw.get_by_role('heading', name='Outcome unknown', exact=True)).to_be_visible()
    expect(sw.get_by_role('button', name='Apply ', exact=False)).to_be_disabled()
    page.unroute('**/api/sync/fields/execute')
    cases.append('transport failure is unknown, cannot replay the stale plan')

    page.locator('.topbar-segment-overflow').click()
    page.get_by_role('menuitem', name='EXPORT', exact=False).click()
    # The real Library entry captures its exact selection then changes App mode.
    library_row = page.locator('.track-row:visible[data-track-id="1"]').filter(has_text='Neon Current')
    expect(library_row).to_have_count(1)
    library_row.click()
    expect(library_row).to_have_class(re.compile('track-row-selected'))
    expect(page.get_by_role('button', name='Review fields…', exact=True)).to_have_attribute('data-field-scope', 'selected')
    page.get_by_role('button', name='Review fields…', exact=True).click()
    expect(sw).to_be_visible()
    expect(sw.get_by_label('Review scope', exact=True)).to_have_value('captured')
    expect(sw).to_contain_text('Exact IDs: 1')
    recheck()
    expect(sw.get_by_text('1 tracks · IDs 1', exact=False)).to_be_visible()
    page.locator('.topbar-segment-overflow').click()
    page.get_by_role('menuitem', name='EXPORT', exact=False).click()
    page.get_by_text('Integration Set', exact=True).filter(visible=True).first.click()
    page.get_by_role('button', name='Export this playlist', exact=True).click()
    expect(sw.get_by_label('Review operation')).to_have_value('playlist')
    expect(sw.get_by_label('Library playlist', exact=True)).to_have_value('Integration Set')
    cases.append('legacy EXPORT retained; real Library field/playlist entries route captured context to Sync')
    assert sw.get_by_role('link', name='Phone sync settings').get_attribute('href') == '?view=settings&section=phone-sync'
    sw.get_by_role('link', name='Phone sync settings').click()
    expect(page.locator('.topbar-mode-control').get_by_role('button', name='Settings', exact=True)).to_have_attribute('aria-pressed', 'true')
    cases.append('phone setup link opens actual App Settings route')
    assert not errors, errors
    print({'pin': identity['pin'], 'cases': cases, 'page_errors': errors, 'http_errors': http_errors})
    browser.close()
