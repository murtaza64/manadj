"""Optional real-browser check: uv run --with playwright -m pytest -q tests/test_review_dashboard_browser.py"""

import threading
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import pytest

from tests.test_review_dashboard import dashboard


@pytest.mark.usefixtures('tmp_path')
def test_browser_keeps_draft_and_displays_revision_bound_action(tmp_path):
    playwright = pytest.importorskip('playwright.sync_api')
    (tmp_path / '.es/mail').mkdir(parents=True)
    row = {'lane': 'sample', 'status': 'parked', 'issue': '#364', 'revision': 'a' * 40,
           'prototype': False, 'summary': 'Dashboard review', 'change': 'kyurn',
           'preview': 'http://127.0.0.1:5189/prototype/phone-performance?variant=stack'}
    desk = dashboard.Desk(tmp_path, transport=lambda action: 'project#1')
    desk.wake = lambda action: None
    desk.token = 'fixture-token'
    desk.issue_rows = lambda: [{'number': 364, 'title': 'Dashboard review', 'body': 'Review UI', 'labels': ['feature:dev-dashboard']}]
    server = ThreadingHTTPServer(('127.0.0.1', 0), dashboard.handler(desk))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with patch.object(dashboard, 'lane_rows', side_effect=lambda _: [row.copy()]):
            with playwright.sync_playwright() as p:
                browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                                            headless=True, args=['--no-sandbox', '--disable-gpu'])
                page = browser.new_page(viewport={'width': 1280, 'height': 800})
                page.clock.install()
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                page.locator('.detail.selected textarea').fill('Please tighten spacing')
                page.clock.fast_forward(31000)
                assert page.locator('.detail.selected textarea').input_value() == 'Please tighten spacing'
                page.evaluate('document.activeElement.blur()')
                row['status'] = 'active'
                page.clock.fast_forward(31000)
                playwright.expect(page.locator('.detail.selected .state')).to_have_text('In progress')
                row['status'] = 'parked'
                page.reload()
                assert page.locator('.detail.selected textarea').input_value() == 'Please tighten spacing'
                assert 'variant=stack' in page.locator('.detail.selected a:has-text("Open preview")').get_attribute('href')
                page.locator('.detail.selected button:has-text("Send feedback")').click()
                page.wait_for_function("document.querySelector('.detail.selected textarea').value === ''")
                assert desk.actions()[0]['state'] == 'dispatched'
                page.reload()
                assert page.locator('.detail.selected .history-list').nth(1).inner_text().count('dispatched') == 1
                page.on('dialog', lambda dialog: dialog.accept())
                page.locator('.detail.selected button:has-text("Approve landing")').click()
                page.wait_for_function("document.getElementById('notice').textContent.includes('dispatched')")
                assert desk.actions()[0]['revision'] == 'a' * 40
                row['revision'] = 'b' * 40
                page.reload()
                assert page.locator('.detail.selected .history-list').nth(1).inner_text().count('REVIEWED REVISION CHANGED') == 1
                row['revision'] = 'a' * 40
                desk.is_landed = lambda revision: revision == 'a' * 40
                approval_id = next(action['id'] for action in desk.actions() if action['kind'] == 'approve')
                desk.transition(approval_id, 'acknowledged')
                desk.transition(approval_id, 'completed', result='main includes reviewed revision')
                row['revision'] = 'b' * 40
                page.reload()
                assert 'REVIEWED REVISION CHANGED' not in page.locator('.detail.selected .history-list').nth(1).inner_text()
                row['preview'] = ''
                page.reload()
                with page.expect_popup() as opening:
                    page.locator('.detail.selected button:has-text("Start preview")').click()
                waiting = opening.value
                waiting.wait_for_url(f'http://127.0.0.1:{server.server_port}/preview?lane=sample')
                assert 'Waiting for the owning lane' in waiting.locator('h1').inner_text()
                row['preview'] = f'http://127.0.0.1:{server.server_port}/'
                waiting.wait_for_url(f'http://127.0.0.1:{server.server_port}/', timeout=10000)
                assert any(action['kind'] == 'preview' and action['state'] == 'dispatched' for action in desk.actions())
                page.set_viewport_size({'width': 390, 'height': 844})
                page.reload()
                assert page.locator('.mobile-feature-menu').is_visible()
                assert page.locator('.detail.selected').is_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


def test_columns_scroll_independently_under_pinned_toolbar(tmp_path):
    playwright = pytest.importorskip('playwright.sync_api')
    (tmp_path / '.es/mail').mkdir(parents=True)
    rows = [{'lane': f'sample-{n}', 'status': 'parked', 'issue': f'#{100 + n}',
             'revision': 'a' * 40, 'prototype': False, 'summary': 'Long review',
             'change': 'kyurn', 'preview': ''} for n in range(35)]
    desk = dashboard.Desk(tmp_path, transport=lambda action: 'project#1')
    desk.token = 'fixture-token'
    desk.issue_rows = lambda: [{'number': 100 + n, 'title': f'feature-{n}: work {n}',
                                'body': 'Review scope ' * 160, 'labels': [f'feature:feature-{n}']}
                               for n in range(35)]
    server = ThreadingHTTPServer(('127.0.0.1', 0), dashboard.handler(desk))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with patch.object(dashboard, 'lane_rows', side_effect=lambda _: rows):
            with playwright.sync_playwright() as p:
                browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                                            headless=True, args=['--no-sandbox', '--disable-gpu'])
                page = browser.new_page(viewport={'width': 1280, 'height': 650})
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                for width in (1280, 800, 390):
                    page.set_viewport_size({'width': width, 'height': 650})
                    geometry = page.evaluate('''() => {
                      const select = s => document.querySelector(s);
                      const visible = width => width <= 650
                        ? ['.queue-pane', '.detail-pane']
                        : ['.feature-pane', '.queue-pane', '.detail-pane'];
                      const panes = visible(innerWidth).map(select);
                      const before = panes.map(el => el.scrollTop);
                      const columns = panes.map((el, index) => {
                        el.scrollTop = el.scrollHeight;
                        const own = el.scrollTop;
                        const others = panes.filter((_, n) => n !== index).map(e => e.scrollTop);
                        el.scrollTop = before[index];
                        return {own, others, expected: before.filter((_, n) => n !== index)};
                      });
                      return {document: document.documentElement.scrollHeight,
                        viewport: document.documentElement.clientHeight,
                        horizontal: document.documentElement.scrollWidth <= innerWidth,
                        toolbarTop: select('.app-header').getBoundingClientRect().top,
                        columns};
                    }''')
                    assert abs(geometry['document'] - geometry['viewport']) <= 1, geometry
                    assert geometry['horizontal'] and geometry['toolbarTop'] == 0, geometry
                    assert all(col['own'] > 0 and col['others'] == col['expected'] for col in geometry['columns']), geometry
                    page.evaluate('document.activeElement.blur()')
                    page.locator('.detail.selected textarea').focus()
                    focus = page.evaluate('''() => ({input: document.activeElement.getBoundingClientRect().bottom,
                      pane: document.querySelector('.detail-pane').getBoundingClientRect().bottom,
                      scroll: document.querySelector('.detail-pane').scrollTop})''')
                    assert focus['input'] <= focus['pane'], (width, focus)
                    assert page.evaluate('document.querySelector(".app-header").getBoundingClientRect().top') == 0
                page.locator('.mobile-feature-menu > summary').click()
                assert page.evaluate('document.documentElement.scrollHeight - document.documentElement.clientHeight') <= 1
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


def test_phone_support_lanes_do_not_duplicate_ready_work(tmp_path):
    playwright = pytest.importorskip('playwright.sync_api')
    (tmp_path / '.es/mail').mkdir(parents=True)
    rows = [
        {'lane': 'critique', 'issue': '365', 'status': 'parked', 'prototype': True,
         'summary': 'Critique complete', 'change': 'critique', 'revision': 'b' * 40, 'preview': ''},
        {'lane': 'phone', 'issue': '#365', 'status': 'active', 'claim-label': 'agent:phone',
         'prototype': True, 'summary': 'tmp: phone', 'change': 'phone', 'revision': 'a' * 40,
         'preview': 'http://127.0.0.1:5190/review.html'},
        {'lane': 'design', 'issue': '365', 'status': 'parked', 'support-for': 'phone',
         'prototype': True, 'summary': 'Design complete', 'change': 'design', 'revision': 'c' * 40,
         'preview': ''},
    ]
    desk = dashboard.Desk(tmp_path, transport=lambda action: 'project#1')
    desk.token = 'fixture-token'
    desk.issue_rows = lambda: [{'number': 365, 'title': 'android-performance: phone performance',
                                'body': 'Native phone', 'labels': ['agent:phone']}]
    desk.runtime = lambda row: 'Running' if row['lane'] == 'phone' else 'Unavailable'
    server = ThreadingHTTPServer(('127.0.0.1', 0), dashboard.handler(desk))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with patch.object(dashboard, 'lane_rows', side_effect=lambda _: rows):
            with playwright.sync_playwright() as p:
                browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                                            headless=True, args=['--no-sandbox'])
                page = browser.new_page(viewport={'width': 1280, 'height': 800})
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                assert page.locator('.work-row').count() == 1
                assert 'Ready 0' in page.locator('.header-stats').inner_text()
                assert page.locator('.detail.selected .target-lane').input_value() == 'phone'
                assert page.locator('.detail.selected .preview-open').get_attribute('href') == 'http://127.0.0.1:5190/review.html'
                assert page.locator('.detail.selected .approval').is_hidden()
                assert page.locator('.detail.selected .history-list').first.locator('li').count() == 3
                page.locator('.detail.selected .target-lane').select_option('design')
                assert page.locator('.detail.selected .preview-start').is_visible()
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
