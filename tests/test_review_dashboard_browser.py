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
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                page.locator('.detail.selected textarea').fill('Please tighten spacing')
                page.reload()
                assert page.locator('.detail.selected textarea').input_value() == 'Please tighten spacing'
                assert 'variant=stack' in page.locator('.detail.selected a:has-text("Open preview")').get_attribute('href')
                page.locator('.detail.selected button:has-text("Send feedback")').click()
                page.wait_for_function("document.querySelector('.detail.selected textarea').value === ''")
                assert desk.actions()[0]['state'] == 'dispatched'
                page.reload()
                assert page.locator('.detail.selected .history-list').first.inner_text().count('dispatched') == 1
                page.on('dialog', lambda dialog: dialog.accept())
                page.locator('.detail.selected button:has-text("Approve landing")').click()
                page.wait_for_function("document.getElementById('notice').textContent.includes('dispatched')")
                assert desk.actions()[0]['revision'] == 'a' * 40
                row['revision'] = 'b' * 40
                page.reload()
                assert page.locator('.detail.selected .history-list').first.inner_text().count('REVIEWED REVISION CHANGED') == 1
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
