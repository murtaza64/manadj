#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["playwright"]
# ///
"""Run only against #430's explicitly identified synthetic review server."""
import argparse
from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True)
args = parser.parse_args()
url = args.url.rstrip('/')
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    assert page.request.get(url + '/fixture/identity').json() == {'fixture': 'field-review-430', 'real_external_writes': False, 'library': 'Alembic in-memory'}
    errors, mutations, cases = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: mutations.append(request.url) if request.method == 'POST' and '/api/' in request.url else None)

    def start(scenario='normal'):
        assert page.request.post(url + '/fixture/reset', params={'scenario': scenario}).status == 200
        page.goto(url)
        page.get_by_role('button', name='Review fields…', exact=True).click()

    def recheck():
        page.get_by_role('button', name='Recheck plan', exact=True).click()
        expect(page.get_by_role('status')).to_have_count(0)
        expect(page.get_by_text('tracks · IDs', exact=False)).to_be_visible()

    def apply():
        page.get_by_role('button', name='Apply ', exact=False).click()

    start()
    recheck()
    expect(page.get_by_text('2 tracks · IDs 1, 2', exact=False)).to_be_visible()
    page.screenshot(path='/tmp/opencode/manadj-fields430-plan.png')
    page.get_by_label('Replace saved key for Eyes Cut Deeper', exact=True).check()
    apply()
    expect(page.get_by_role('heading', name='Field receipt', exact=True)).to_be_visible()
    tracks = page.request.get(url + '/api/tracks/').json()['items']
    assert tracks[0]['key'] == 7 and tracks[1]['key'] == 8 and tracks[2]['key'] == 8
    writes = page.request.get(url + '/fixture/writes').json()
    assert not any(write['id'] not in (1, 2) for write in writes)
    assert not any(write['field'] == 'key' and write['id'] == 2 for write in writes)
    cases.append('real Library persistence / selected IDs / independent overwrite consent')

    for scope, ids in [('filtered', '1, 2, 3, 4'), ('all', '1, 2, 3, 4, 5, 6')]:
        start()
        page.get_by_label('Field scope').select_option(scope)
        recheck()
        expect(page.get_by_text(f'tracks · IDs {ids} ·', exact=False)).to_be_visible()
        cases.append(f'exact {scope} scope')

    start()
    recheck()
    page.request.post(url + '/fixture/change')
    apply()
    expect(page.get_by_role('heading', name='Operation not started', exact=True)).to_be_visible()
    expect(page.get_by_text('nothing started', exact=False)).to_be_visible()
    assert page.request.get(url + '/fixture/writes').json() == []
    cases.append('changed target rejected before any dispatch')

    start('partial')
    recheck()
    apply()
    expect(page.get_by_role('heading', name='Needs attention', exact=True)).to_be_visible()
    expect(page.get_by_text('hotcues · failed', exact=False)).to_be_visible()
    cases.append('field partial receipt')

    start('unknown')
    recheck()
    apply()
    expect(page.get_by_role('heading', name='Outcome unknown', exact=True)).to_be_visible()
    cases.append('post-dispatch exception remains unknown')

    start()
    page.get_by_label('hotcues', exact=True).uncheck()
    page.get_by_label('maincue', exact=True).uncheck()
    page.get_by_label('Field direction').select_option('export')
    recheck()
    page.get_by_label('Replace saved key for Eyes Cut Deeper', exact=True).check()
    apply()
    expect(page.get_by_role('heading', name='Field receipt', exact=True)).to_be_visible()
    writes = page.request.get(url + '/fixture/writes').json()
    assert writes == [{'id': 1, 'field': 'key', 'direction': 'export'}]
    cases.append('scoped external adapter export; no other fields or IDs')

    start('gated')
    page.get_by_label('Field direction').select_option('export')
    recheck()
    expect(page.get_by_text('External export is off.', exact=False)).to_be_visible()
    expect(page.get_by_role('button', name='Apply ', exact=False)).to_be_disabled()
    assert page.request.get(url + '/fixture/writes').json() == []
    cases.append('export gate blocks Apply without disabling import')

    start('blocked')
    page.get_by_label('Field scope').select_option('all')
    recheck()
    expect(page.get_by_role('button', name='Apply ', exact=False)).to_be_disabled()
    cases.append('missing records block; no invented creation')

    start()
    page.locator('.pei-footer').get_by_role('button', name='Close', exact=True).click()
    page.get_by_role('button', name='Actual Tracks inbox', exact=True).click()
    page.get_by_role('button', name='Review group fields…', exact=True).click()
    recheck()
    expect(page.get_by_text('6 tracks · IDs 1, 2, 3, 4, 5, 6', exact=False)).to_be_visible()
    cases.append('actual Tracks group → same real field contract')

    page.locator('.pei-footer').get_by_role('button', name='Close', exact=True).click()
    page.get_by_role('button', name='▸', exact=True).click()
    page.get_by_role('button', name='Review fields: Eyes Cut Deeper', exact=True).click()
    recheck()
    expect(page.get_by_text('1 tracks · IDs 1 ·', exact=False)).to_be_visible()
    page.get_by_label('Replace saved key for Eyes Cut Deeper', exact=True).check()
    apply()
    expect(page.get_by_role('heading', name='Field receipt', exact=True)).to_be_visible()
    assert page.request.get(url + '/api/tracks/').json()['items'][0]['key'] == 7
    cases.append('actual Tracks row → per-field consent → real Library Apply')

    start()
    recheck()
    held = []
    page.route('**/api/sync/fields/execute', lambda route: held.append(route))
    apply()
    expect(page.get_by_role('button', name='Applying…', exact=True)).to_be_disabled()
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_be_visible()
    try:
        for tab in ['Tab', 'Tab', 'Shift+Tab', 'Tab', 'Shift+Tab']:
            page.keyboard.press(tab)
            assert page.evaluate('document.querySelector("[role=dialog]").contains(document.activeElement)'), 'Pending focus escaped into background'
        # Exercise the out-of-dialog and no-eligible-control fallbacks too.
        page.locator('main > nav button').first.focus()
        page.keyboard.press('Shift+Tab')
        assert page.evaluate('document.querySelector("[role=dialog]").contains(document.activeElement)')
        page.get_by_role('dialog').evaluate('dialog => dialog.querySelectorAll("button,input,select,summary").forEach(el => { el.disabled = true; el.tabIndex = -1; })')
        page.keyboard.press('Tab')
        assert page.evaluate('document.querySelector("[role=dialog]") === document.activeElement')
    finally:
        for route in held:
            route.fulfill(status=503, json={})
        page.unroute('**/api/sync/fields/execute')
    expect(page.get_by_role('heading', name='Outcome unknown', exact=True)).to_be_visible()
    cases.append('pending Tab/Shift+Tab/outside/empty focus trap; lost response unknown')

    start()
    recheck()
    assert page.locator('.field-replacement').first.evaluate('el => getComputedStyle(el).color') == 'rgb(255, 204, 0)'
    cases.append('replacement consent uses semantic warning color')

    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path='/tmp/opencode/manadj-fields430-narrow.png')
    close = page.locator('.pei-footer').get_by_role('button', name='Close', exact=True)
    close.focus()
    page.keyboard.press('Shift+Tab')
    assert page.evaluate('document.querySelector("[role=dialog]").contains(document.activeElement)')
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_have_count(0)
    cases.append('390px / focus trap / Escape')
    assert not errors, errors
    assert all('/api/sync/fields/' in mutation for mutation in mutations), mutations
    print({'cases': cases, 'browser_errors': errors, 'legacy_mutations': 0})
    browser.close()
