import importlib.util
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen

MODULE = Path(__file__).resolve().parents[1] / 'scripts/agent/review_dashboard.py'
spec = importlib.util.spec_from_file_location('review_dashboard', MODULE)
dashboard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dashboard)


class ReviewDeskTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.row = {'lane': 'sample', 'status': 'parked', 'revision': 'a' * 40,
                    'prototype': False, 'summary': 'feature: test', 'change': 'abc', 'preview': ''}
        self.lanes = patch.object(dashboard, 'lane_rows', side_effect=lambda _: [self.row.copy()])
        self.lanes.start()
        self.addCleanup(self.lanes.stop)
        self.delivered = []
        def transport(action):
            self.delivered.append(action['id'])
            return 'project#1'
        self.desk = dashboard.Desk(self.root, transport=transport)
        self.desk.wake = lambda _: None

    def test_idempotent_feedback_and_dispatch(self):
        self.desk.enqueue('sample', 'feedback', 'Make the knob larger', 'feedback-0001')
        self.desk.enqueue('sample', 'feedback', 'Make the knob larger', 'feedback-0001')
        with self.assertRaises(ValueError):
            self.desk.enqueue('sample', 'feedback', 'Different', 'feedback-0001')
        self.desk.dispatch()
        self.desk.dispatch()
        self.assertEqual(self.delivered, ['feedback-0001'])
        self.assertEqual(self.desk.actions()[0]['state'], 'dispatched')
        self.desk.transition('feedback-0001', 'acknowledged')
        self.desk.transition('feedback-0001', 'completed')
        self.assertEqual(self.desk.actions()[0]['state'], 'completed')

    def test_approval_is_pinned_and_stale_revision_fails(self):
        with self.assertRaises(ValueError):
            self.desk.enqueue('sample', 'approve', '', 'approve-0001', 'b' * 40)
        self.desk.enqueue('sample', 'approve', '', 'approve-0001', 'a' * 40)
        self.row['revision'] = 'b' * 40
        self.desk.dispatch()
        self.assertEqual(self.delivered, [])
        self.assertEqual(self.desk.actions()[0]['state'], 'failed')
        with self.assertRaises(ValueError):
            self.desk.retry('approve-0001')

    def test_prototype_never_approves(self):
        self.row['prototype'] = True
        with self.assertRaises(ValueError):
            self.desk.enqueue('sample', 'approve', '', 'approve-0002', 'a' * 40)
        self.desk.enqueue('sample', 'feedback', 'Try focus view', 'feedback-0002')

    def test_failure_is_retriable_without_duplicate_entry(self):
        def failing(_):
            raise OSError('transport offline')
        self.desk.transport = failing
        self.desk.enqueue('sample', 'preview', '', 'preview-0001')
        self.desk.dispatch()
        self.assertEqual(self.desk.actions()[0]['state'], 'failed')
        self.desk.transport = lambda action: 'project#2'
        self.desk.retry('preview-0001')
        self.desk.dispatch()
        self.assertEqual(len(self.desk.actions()), 1)
        self.assertEqual(self.desk.actions()[0]['state'], 'dispatched')

    def test_preview_link_and_issue_content_render(self):
        self.row['preview'] = 'http://127.0.0.1:5183/prototype/phone-performance?variant=stack'
        self.row['issue'] = '#1'
        self.desk.issue_rows = lambda: [{'number': 1, 'title': 'Android phone', 'body': 'Two deck UI', 'labels': ['feature:mobile']}]
        self.desk.issue_error = ''
        self.desk.token = 'test-token'
        (self.root / '.es/mail').mkdir(parents=True)
        rendered = dashboard.page(self.desk)
        self.assertIn('Open preview', rendered)
        self.assertIn('variant=stack', rendered)
        self.assertIn('Android phone', rendered)

    def test_post_landing_approval_completion_accepts_main_ancestry(self):
        self.desk.is_landed = lambda revision: revision == 'a' * 40
        self.desk.enqueue('sample', 'approve', '', 'approve-0003', 'a' * 40)
        self.desk.dispatch()
        self.desk.transition('approve-0003', 'acknowledged')
        self.row['revision'] = 'b' * 40  # land.py moved lane @ after verified landing
        with self.assertRaises(ValueError):
            self.desk.transition('approve-0003', 'completed')
        self.assertEqual(self.desk.transition('approve-0003', 'completed', result='main merge xyz')['state'], 'completed')

    def test_wake_accepts_canonical_repo_root_and_explicit_openai_model(self):
        self.desk.wake = dashboard.Desk.wake.__get__(self.desk)
        self.desk.enqueue('sample', 'feedback', 'Hello', 'feedback-0003')
        self.desk.transport = lambda _: 'project#3'
        config = self.root / '.review-dashboard/orchestrator.json'
        config.write_text(json.dumps({'session': 'ses_orchestrator123', 'directory': str(self.root.parent),
                                      'agent': 'yolo', 'model': 'gpt-6-astra'}))
        captured = []
        class Response:
            def __init__(self, data):
                self.data = data
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return None
            def read(self, *_):
                return json.dumps(self.data).encode()
        def fake_urlopen(request, timeout):
            url = request.full_url if isinstance(request, Request) else request
            if '/prompt_async' in url:
                captured.append(json.loads(request.data))
                return Response({})
            if '/session/status' in url:
                return Response({})
            if '/session/ses_orchestrator123/message' in url:
                return Response([{'info': {'role': 'user'}, 'parts': captured[-1]['parts']}] if captured else [])
            if '/session/ses_orchestrator123?' in url:
                return Response({'id': 'ses_orchestrator123', 'directory': str(self.root.parent)})
            if '/agent?' in url:
                return Response([{'name': 'yolo'}])
            raise AssertionError(url)
        with patch.object(dashboard, 'urlopen', side_effect=fake_urlopen):
            self.desk.dispatch()
        self.assertEqual(captured[0]['model'], {'providerID': 'openai', 'modelID': 'gpt-6-astra'})
        self.assertGreater(self.desk.actions()[0]['wake_at'], 0)

    def test_preview_wait_page_and_status_use_live_lane_metadata(self):
        from http.server import ThreadingHTTPServer
        self.desk.token = 'test-token'
        server = ThreadingHTTPServer(('127.0.0.1', 0), dashboard.handler(self.desk))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.row['preview'] = ''
        with urlopen(f'http://127.0.0.1:{server.server_port}/preview?lane=sample') as response:
            self.assertIn(b'Waiting for the owning lane', response.read())
        self.row['preview'] = 'http://127.0.0.1:5183/prototype/phone-performance?variant=stack'
        with urlopen(f'http://127.0.0.1:{server.server_port}/preview-status?lane=sample') as response:
            self.assertIn('variant=stack', json.load(response)['preview'])

    def test_dashboard_uses_shared_theme_and_keeps_feedback_draft(self):
        self.desk.issue_rows = lambda: []
        self.desk.token = 'test-token'
        (self.root / '.es/mail').mkdir(parents=True)
        rendered = dashboard.page(self.desk)
        styles = (MODULE.parent / 'review_dashboard.css').read_text()
        script = (MODULE.parent / 'review_dashboard.js').read_text()
        self.assertIn('class="queue-pane"', rendered)
        self.assertIn('class="detail-pane"', rendered)
        self.assertIn('UbuntuMono Nerd Font', styles)
        self.assertIn('var(--accent)', styles)
        self.assertNotIn('system-ui', styles)
        self.assertIn('sessionStorage.setItem(draftKey(', script)

    def test_custom_preview_metadata_uses_loopback_without_lane_app(self):
        self.lanes.stop()
        self.addCleanup(lambda: None)
        lane = self.root / 'lanes/sample'
        (lane / 'repos/murtaza64/manadj').mkdir(parents=True)
        (lane / 'LANE.md').write_text('status: parked\nports: vite=5189\n'
                                      'preview-route: /prototype/phone-performance?variant=stack\n'
                                      'preview-url: http://192.168.16.63:5189/prototype/phone-performance\n')
        class Connection:
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return None
        with patch.object(dashboard, 'run', return_value='a' * 40), patch.object(
            dashboard.socket, 'create_connection', return_value=Connection()
        ):
            row = dashboard.lane_rows(self.root)[0]
        self.assertEqual(row['preview'], 'http://127.0.0.1:5189/prototype/phone-performance?variant=stack')

    def test_mail_receipt_prevents_duplicate_delivery_after_restart(self):
        path = self.root / '.es/mail'
        path.mkdir(parents=True)
        (path / 'project.jsonl').write_text(json.dumps({
            'id': 'project#1', 'from': 'human',
            'text': 'Dashboard action feedback-0004 (feedback) issue=#364 lane=sample'
        }) + '\n')
        action = self.desk.enqueue('sample', 'feedback', 'Hello', 'feedback-0004')
        with patch.object(dashboard, 'run', side_effect=AssertionError('duplicate mail')):
            self.assertEqual(self.desk.deliver(action), 'project#1')

    def test_cross_origin_post_cannot_queue_action(self):
        from http.server import ThreadingHTTPServer
        from urllib.error import HTTPError
        self.desk.token = 'test-token'
        server = ThreadingHTTPServer(('127.0.0.1', 0), dashboard.handler(self.desk))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        payload = json.dumps({'id': 'feedback-0005', 'lane': 'sample', 'kind': 'feedback', 'text': 'Hello'}).encode()
        req = Request(f'http://127.0.0.1:{server.server_port}/action', data=payload, method='POST',
                      headers={'Content-Type': 'application/json', 'X-Review-Token': 'test-token',
                               'Origin': 'https://example.com'})
        with self.assertRaises(HTTPError) as rejected:
            urlopen(req)
        self.assertEqual(rejected.exception.code, 403)
        self.assertEqual(self.desk.actions(), [])

    def test_claimed_issue_is_one_active_item_despite_parked_support(self):
        author = {'lane': 'phone-author', 'issue': '#365', 'claim-label': 'agent:phone-author',
                  'status': 'active', 'prototype': True}
        critique = {'lane': 'phone-critique', 'issue': '365', 'status': 'parked', 'kind': 'prototype'}
        design = {'lane': 'phone-design', 'issue': '365', 'support-for': 'phone-author', 'status': 'parked'}
        issue = {'number': 365, 'title': 'Android phone', 'labels': ['agent:phone-author']}
        items = dashboard.grouped_work([critique, author, design], [issue], [])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['section'], 'In progress')
        self.assertEqual(items[0]['primary']['lane'], 'phone-author')
        self.assertEqual(len(items[0]['participants']), 3)
        author['status'] = 'parked'
        self.assertEqual(dashboard.grouped_work([critique, author, design], [issue], [])[0]['section'], 'Ready to test')
        issue['labels'].append('flagged')
        self.assertEqual(dashboard.grouped_work([critique, author, design], [issue], [])[0]['section'], 'Needs you')

    def test_unclaimed_multi_lane_issue_requires_explicit_target_and_untracked_lane_stays_separate(self):
        rows = [{'lane': 'support-a', 'issue': '365', 'status': 'parked'},
                {'lane': 'support-b', 'issue': '#365', 'status': 'parked'},
                {'lane': 'scratch', 'issue': '', 'status': 'active'}]
        items = dashboard.grouped_work(rows, [{'number': 365, 'labels': []}], [])
        self.assertEqual(len(items), 2)
        grouped = next(item for item in items if item['number'] == '365')
        self.assertIsNone(grouped['primary'])
        self.assertEqual(grouped['section'], 'Needs you')
        self.assertEqual(next(item for item in items if not item['number'])['primary']['lane'], 'scratch')

    def test_runtime_distinguishes_running_idle_and_unavailable(self):
        row = {'owner': 'ses_fixture123', 'workspace': str(self.root)}
        class Response:
            def __init__(self, data):
                self.data = data
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return None
            def read(self, *_):
                return json.dumps(self.data).encode()
        def live(url, timeout):
            if '/session/status?' in url:
                return Response({'ses_fixture123': {'type': 'busy'}})
            return Response({'id': 'ses_fixture123', 'directory': str(self.root)})
        with patch.object(dashboard, 'urlopen', side_effect=live):
            self.assertEqual(self.desk.runtime(row), 'Running')
        self.desk.runtime_cache.clear()
        with patch.object(dashboard, 'urlopen', side_effect=lambda url, timeout: Response(
            {} if '/session/status?' in url else {'id': 'ses_fixture123', 'directory': str(self.root)}
        )):
            self.assertEqual(self.desk.runtime(row), 'Idle')
        self.desk.runtime_cache.clear()
        with patch.object(dashboard, 'urlopen', side_effect=OSError('daemon offline')):
            self.assertEqual(self.desk.runtime(row), 'Unavailable')


if __name__ == '__main__':
    unittest.main()
