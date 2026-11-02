#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["playwright"]
# ///
"""Check only an identified #442 disposable production-adapter fixture."""
import argparse
from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True)
parser.add_argument('--artifacts-prefix', default='/tmp/opencode/manadj-library442-correction')
args = parser.parse_args()
url = args.url.rstrip('/')
with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    identity = page.request.get(url + '/fixture/identity').json()
    assert identity['fixture'] == 'library-export-442' and not identity['installed_app']
    assert identity.get('engine_identity_fixture') is True
    errors, external, cases = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: external.append(request.url) if not request.url.startswith(url + '/') else None)

    def fields(surface='rekordbox'):
        page.get_by_role('button', name='Review fields…', exact=True).click()
        page.get_by_label('Field direction').select_option('export')
        page.get_by_label('Field surface').select_option(surface)

    def recheck():
        page.get_by_role('button', name='Recheck plan', exact=True).click()
        expect(page.get_by_text('tracks · IDs', exact=False)).to_be_visible()

    def close():
        page.get_by_role('button', name='Close', exact=True).last.click()

    page.goto(url)
    expect(page.get_by_text('Neon Current', exact=True).first).to_be_visible()
    fields()
    page.get_by_label('Field scope').select_option('all')
    recheck()
    expect(page.get_by_text('4 tracks · IDs 1, 2, 3, 4', exact=False)).to_be_visible()
    expect(page.get_by_role('button', name='Apply ', exact=False)).to_be_disabled()
    cases.append('actual full Library all scope; missing records block field-only writes')
    close()

    page.get_by_placeholder('search...', exact=True).fill('Neon')
    # FilterBar applies search after its debounce. Capture the applied filter,
    # not a scope frozen while the old four-row result is still current.
    expect(page.get_by_role('row').filter(has_text='Signal Loop')).to_have_count(0)
    fields()
    page.get_by_label('Field scope').select_option('filtered')
    recheck()
    expect(page.get_by_text('1 tracks · IDs 1', exact=False)).to_be_visible()
    cases.append('actual complete-filtered Library scope captures matching ID only')
    close()
    page.get_by_placeholder('search...', exact=True).fill('')
    expect(page.get_by_role('row').filter(has_text='Signal Loop')).to_have_count(1)

    page.get_by_text('Neon Current', exact=True).first.click()
    fields('engine')
    for field in ['hotcues', 'maincue']:
        page.get_by_label(field, exact=True).uncheck()
    with page.expect_response(lambda response: response.url.endswith('/api/sync/fields/plan')) as observed:
        recheck()
    planned = observed.value.json()
    assert planned['track_ids'] == [1]
    assert planned['tracks'][0]['fields'][0]['before'] == 1
    assert planned['tracks'][0]['fields'][0]['after'] == 7
    assert planned['tracks'][0]['fields'][0]['action'] == 'consent'
    expect(page.get_by_role('group', name='Key change').locator('.pei-value-before')).to_contain_text('1m')
    page.get_by_label('Replace saved key for Neon Current', exact=True).check()
    page.screenshot(path=args.artifacts_prefix + '-engine-before.png')
    page.get_by_role('button', name='Apply ', exact=False).click()
    expect(page.get_by_role('heading', name='Field receipt', exact=True)).to_be_visible()
    engine_evidence = page.request.get(url + '/fixture/evidence').json()
    assert [row['key'] for row in engine_evidence['engine']] == [7, 7]
    assert any('Engine Library-snapshots' in name for name in engine_evidence['backups'])
    cases.append('Engine duplicate basenames: actual Library before1/consent changes exact first row; second stays7')
    close()

    page.get_by_text('Neon Current', exact=True).first.click()
    fields()
    recheck()
    expect(page.get_by_text('1 tracks · IDs 1', exact=False)).to_be_visible()
    page.get_by_label('Replace saved hotcues for Neon Current', exact=True).check()
    page.get_by_label('Replace saved maincue for Neon Current', exact=True).check()
    page.screenshot(path=args.artifacts_prefix + '-selected-plan.png')
    page.get_by_role('button', name='Apply ', exact=False).click()
    expect(page.get_by_role('heading', name='Field receipt', exact=True)).to_be_visible()
    evidence = page.request.get(url + '/fixture/evidence').json()
    assert len(evidence['native']['share/1/ANLZ0000.EXT']) == 3
    assert evidence['backups'], evidence
    cases.append('selected scope + consent -> production writer DB/native bytes and actual backup')
    close()

    page.get_by_text('New Destination', exact=True).first.click()
    fields()
    recheck()
    expect(page.get_by_role('button', name='Apply ', exact=False)).to_be_disabled()
    expect(page.get_by_role('dialog')).to_contain_text('Record absent or ambiguous downstream')
    close()
    page.get_by_text('Integration Set', exact=True).first.click()
    page.get_by_role('button', name='Export this playlist', exact=True).click()
    page.get_by_label('Export destination').select_option('rekordbox')
    expect(page.get_by_text('ADD DESTINATION RECORD', exact=True)).to_be_visible()
    expect(page.get_by_text('UNAVAILABLE · omitted', exact=True)).to_be_visible()
    page.locator('.pei-confirm input').check()
    page.get_by_role('button', name='Export reviewed changes', exact=True).click()
    expect(page.get_by_role('heading', name='Export receipt', exact=True)).to_be_visible()
    expect(page.get_by_text('Added 1 destination library record', exact=False)).to_be_visible()
    expect(page.get_by_text('Cue DB committed; native DAT/EXT not synchronized', exact=False).first).to_be_visible()
    page.screenshot(path=args.artifacts_prefix + '-partial-receipt.png')
    evidence = page.request.get(url + '/fixture/evidence').json()
    assert evidence['records'] == 3
    cases.append('separate playlist adds real record; unavailable audio + no-ANLZ partial receipt preserves additions')
    close()

    page.get_by_text('All tracks', exact=True).first.click()
    page.get_by_text('New Destination', exact=True).first.click()
    fields()
    for field in ['hotcues', 'maincue']:
        page.get_by_label(field, exact=True).uncheck()
    recheck()
    expect(page.get_by_text('1 tracks · IDs 3', exact=False)).to_be_visible()
    expect(page.get_by_text('Record absent or ambiguous downstream', exact=False)).to_have_count(0)
    cases.append('Library replan observes separately created destination record, no implicit creation')
    close()

    request = {'track_ids': [1], 'scope': 'selected', 'surface': 'rekordbox',
               'direction': 'export', 'fields': ['hotcues']}
    stale = page.request.post(url + '/api/sync/fields/plan', data=request).json()
    before = page.request.get(url + '/fixture/evidence').json()['cue_rows']
    assert page.request.post(url + '/fixture/gate', params={'enabled': 'false'}).status == 200
    assert page.request.post(url + '/api/sync/fields/execute', data={**request, 'token': stale['token'], 'replacements': []}).status == 403
    assert page.request.post(url + '/fixture/gate', params={'enabled': 'true'}).status == 200
    page.request.post(url + '/fixture/remove-ext')
    assert page.request.post(url + '/api/sync/fields/execute', data={**request, 'token': stale['token'], 'replacements': []}).status == 409
    assert page.request.get(url + '/fixture/evidence').json()['cue_rows'] == before
    cases.append('real export gate and changed-native freshness reject before dispatch')
    page.get_by_text('Neon Current', exact=True).first.click()
    fields()
    page.get_by_label('hotcues', exact=True).uncheck()
    page.get_by_label('maincue', exact=True).uncheck()
    # Same-value key review must not invoke a native repair writer.
    recheck()
    expect(page.get_by_role('button', name='Apply ', exact=False)).to_be_disabled()
    cases.append('same-value field review does not masquerade as native repair')
    close()

    page.set_viewport_size({'width': 390, 'height': 844})
    fields()
    recheck()
    page.screenshot(path=args.artifacts_prefix + '-narrow.png')
    expect(page.get_by_role('dialog')).to_be_visible()
    assert not errors, errors
    assert not external, external
    print({'cases': cases, 'page_errors': errors, 'external_requests': external, 'pin': identity['pin']})
    browser.close()
