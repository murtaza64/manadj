#!/usr/bin/env -S uv run --script
"""Local review desk. Sidecar state only; never starts or lands another lane."""

from __future__ import annotations

import argparse
import html
import json
import socket
import re
import sqlite3
import subprocess
import threading
import time
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parents[2]
SIDECAR = Path('/Users/murtaza/manadj/.editspace')
LANE_RE = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*\Z')
SESSION_RE = re.compile(r'ses_[A-Za-z0-9]+\Z')
SHA_RE = re.compile(r'[0-9a-f]{40}\Z')
PORT_RE = re.compile(r'ports:\s*backend\s+(\d+),\s*vite\s+(\d+)')


def run(*args: str, cwd: Path | None = None) -> str:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=12, check=True).stdout.strip()


def fields(path: Path) -> dict[str, str]:
    return dict(re.findall(r'^([\w-]+):\s*(.*)$', path.read_text(), re.M))


def lane_rows(sidecar: Path) -> list[dict]:
    rows = []
    for record in sorted((sidecar / 'lanes').glob('*/LANE.md')):
        lane = record.parent.name
        if not LANE_RE.fullmatch(lane):
            continue
        data = fields(record)
        workspace = record.parent / 'repos/murtaza64/manadj'
        if not workspace.is_dir():
            continue
        try:
            # git commit id includes uncommitted jj working-copy snapshots.
            revision = run('jj', 'log', '--no-graph', '-r', '@', '-T', 'commit_id', cwd=workspace)
            change = run('jj', 'log', '--no-graph', '-r', '@', '-T', 'change_id.short()', cwd=workspace)
            summary = run('jj', 'log', '--no-graph', '-r', '@', '-T', 'description.first_line()', cwd=workspace)
        except (subprocess.SubprocessError, OSError):
            revision, change, summary = '', '', ''
        port_match = PORT_RE.search(record.read_text())
        port_file = workspace / '.lane-app/ports'
        pid_file = workspace / '.lane-app/dev.pid'
        try:
            pid = int(pid_file.read_text())
            import os
            os.kill(pid, 0)
            port = int(port_file.read_text().split()[1])
            if port_match and port != int(port_match[2]):
                port = 0
        except (OSError, ValueError, IndexError):
            port = 0
        route = data.get('preview-route', '/')
        if not route.startswith('/') or route.startswith('//') or '\\' in route:
            route = '/'
        preview = f'http://127.0.0.1:{port}{route}' if port else ''
        custom_ports = re.search(r'^ports:\s*vite=(\d{2,5})\s*$', record.read_text(), re.M)
        if not preview and custom_ports and 1 <= int(custom_ports[1]) <= 65535:
            try:
                with socket.create_connection(('127.0.0.1', int(custom_ports[1])), timeout=0.15):
                    preview = f'http://127.0.0.1:{int(custom_ports[1])}{route}'
            except OSError:
                pass
        custom = data.get('preview-url', '')
        try:
            parsed = urlsplit(custom)
            custom_port = parsed.port
        except ValueError:
            parsed, custom_port = urlsplit(''), None
        if parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost') and custom_port and not parsed.username:
            try:
                with socket.create_connection(('127.0.0.1', custom_port), timeout=0.15):
                    preview = f'http://127.0.0.1:{custom_port}{parsed.path or "/"}' + (f'?{parsed.query}' if parsed.query else '')
            except OSError:
                pass
        rows.append({**data, 'lane': lane, 'revision': revision if SHA_RE.fullmatch(revision) else '',
                     'change': change, 'summary': summary, 'preview': preview,
                     'route': route, 'prototype': summary.startswith('tmp:') or data.get('kind') == 'prototype',
                     'record_updated': record.stat().st_mtime, 'workspace': str(workspace)})
    return rows


def mail(sidecar: Path) -> list[dict]:
    messages = []
    for file in (sidecar / '.es/mail').glob('*.jsonl'):
        for line in file.read_text().splitlines():
            try:
                messages.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    answered = {m.get('in_reply_to') for m in messages}
    return sorted([{**m, 'open': m.get('kind') == 'question' and m.get('id') not in answered}
                   for m in messages], key=lambda m: m.get('ts', ''), reverse=True)


def grouped_work(rows: list[dict], issues: list[dict], messages: list[dict]) -> list[dict]:
    """One queue item per canonical issue; only a verified claimant can lead multi-lane work."""
    by_issue = {str(issue['number']): issue for issue in issues}
    groups: dict[str, list[dict]] = {}
    for row in rows:
        raw = str(row.get('issue', '')).strip()
        match = re.fullmatch(r'#?(\d+)', raw)
        key = match[1] if match else f"lane:{row['lane']}"
        groups.setdefault(key, []).append(row)
    result = []
    for key, participants in groups.items():
        issue = by_issue.get(key, {})
        labels = set(issue.get('labels') or [])
        claimants = [r for r in participants if r.get('claim-label') and r['claim-label'] in labels]
        if not claimants and not issue:
            claimants = [r for r in participants if r.get('claim-label')]
        if len(claimants) == 1:
            primary = claimants[0]
        elif len(participants) == 1:
            primary = participants[0]
        else:
            primary = None
        if primary:
            participants = [primary, *(r for r in participants if r['lane'] != primary['lane'])]
        lanes = {r['lane'] for r in participants}
        related = [m for m in messages if m.get('from') in lanes or m.get('to') in lanes]
        questions = [m for m in related if m.get('open') and m.get('from') in lanes]
        is_blocked = bool(labels & {'flagged', 'needs-info'})
        if not primary or questions or is_blocked:
            section = 'Needs you'
        elif primary.get('status') in ('parked', 'ready-for-human'):
            section = 'Ready to test'
        else:
            section = 'In progress'
        result.append({'key': f'issue-{key}' if key.isdigit() else key, 'issue': issue,
                       'number': key if key.isdigit() else '', 'participants': participants,
                       'primary': primary, 'messages': related, 'questions': questions,
                       'section': section, 'blocked': is_blocked})
    return result


def age(timestamp: float) -> str:
    elapsed = max(0, int(time.time() - timestamp))
    if elapsed < 60:
        return 'now'
    if elapsed < 3600:
        return f'{elapsed // 60}m ago'
    if elapsed < 86400:
        return f'{elapsed // 3600}h ago'
    return f'{elapsed // 86400}d ago'


def activity_line(row: dict, messages: list[dict]) -> tuple[str, str]:
    newest = next((m for m in messages if m.get('from') == row['lane'] and m.get('text')), None)
    try:
        mail_at = datetime.fromisoformat(newest['ts'].replace('Z', '+00:00')).timestamp() if newest else 0
        record_at = datetime.fromisoformat(row.get('activity-at', '').replace('Z', '+00:00')).timestamp() if row.get('activity-at') else 0
    except ValueError:
        mail_at, record_at = 0, 0
    if mail_at > record_at:
        return newest['text'].splitlines()[0][:150], age(mail_at)
    if row.get('activity'):
        return row['activity'][:150], age(record_at or row.get('record_updated', 0))
    return 'No current activity note', f"record updated {age(row.get('record_updated', 0))}"


class Desk:
    def __init__(self, sidecar: Path, transport=None, is_landed=None):
        self.sidecar = sidecar
        self.is_landed = is_landed or self._is_landed
        self.lock = threading.RLock()
        self.delivery_lock = threading.Lock()
        self.wake_lock = threading.Lock()
        self.last_wake = 0.0
        directory = sidecar / '.review-dashboard'
        directory.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(directory / 'actions.sqlite3', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('''CREATE TABLE IF NOT EXISTS actions (
            id TEXT PRIMARY KEY, lane TEXT NOT NULL, issue TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL, text TEXT NOT NULL,
            revision TEXT NOT NULL, state TEXT NOT NULL, error TEXT NOT NULL DEFAULT '',
            mail_id TEXT NOT NULL DEFAULT '', wake_at REAL NOT NULL DEFAULT 0,
            result TEXT NOT NULL DEFAULT '',
            created REAL NOT NULL, updated REAL NOT NULL)''')
        if 'issue' not in {column[1] for column in self.db.execute('PRAGMA table_info(actions)')}:
            self.db.execute("ALTER TABLE actions ADD COLUMN issue TEXT NOT NULL DEFAULT ''")
        if 'wake_at' not in {column[1] for column in self.db.execute('PRAGMA table_info(actions)')}:
            self.db.execute('ALTER TABLE actions ADD COLUMN wake_at REAL NOT NULL DEFAULT 0')
        if 'result' not in {column[1] for column in self.db.execute('PRAGMA table_info(actions)')}:
            self.db.execute("ALTER TABLE actions ADD COLUMN result TEXT NOT NULL DEFAULT ''")
        self.db.commit()
        self.transport = transport or self.deliver
        self.issues: list[dict] = []
        self.issue_error = ''
        self.issue_at = 0.0
        self.dashboard_url = ''
        self.runtime_cache: dict[str, tuple[float, str]] = {}
        self.walkthroughs: dict[str, tuple[float, list[str]]] = {}
        cache = directory / 'issues.json'
        self.issue_cache = cache
        try:
            self.issues = json.loads(cache.read_text())
        except (OSError, ValueError):
            pass

    def actions(self) -> list[dict]:
        with self.lock:
            return [dict(row) for row in self.db.execute('SELECT * FROM actions ORDER BY created DESC LIMIT 150')]

    def issue_rows(self) -> list[dict]:
        if time.time() - self.issue_at > 300:
            try:
                raw = run('gh', 'api', 'repos/murtaza64/manadj/issues?state=open&per_page=100')
                self.issues = [{'number': i['number'], 'title': i['title'], 'body': (i.get('body') or '')[:1500],
                                'labels': [label['name'] for label in i['labels']]}
                               for i in json.loads(raw) if 'pull_request' not in i]
                self.issue_error = ''
                self.issue_at = time.time()
                self.issue_cache.write_text(json.dumps(self.issues))
            except (OSError, ValueError, subprocess.SubprocessError) as exc:
                self.issue_error = f'GitHub unavailable ({type(exc).__name__}); showing cached issues'
                self.issue_at = time.time() - 270
        return self.issues

    def walkthrough(self, issue: str) -> list[str]:
        if not re.fullmatch(r'#?[0-9]{1,7}', issue):
            return []
        number = issue.lstrip('#')
        cached = self.walkthroughs.get(number)
        if cached and time.time() - cached[0] < 300:
            return cached[1]
        try:
            comments = json.loads(run('gh', 'api', f'repos/murtaza64/manadj/issues/{number}/comments?per_page=100'))
            evidence = [c.get('body', '')[:2500] for c in comments if 'walkthrough' in c.get('body', '').lower()]
            self.walkthroughs[number] = (time.time(), evidence[-3:])
        except (OSError, ValueError, subprocess.SubprocessError):
            return cached[1] if cached else []
        return self.walkthroughs[number][1]

    def runtime(self, row: dict) -> str:
        owner = str(row.get('owner', '')).removeprefix('opencode:')
        directory = row.get('workspace', '')
        if not SESSION_RE.fullmatch(owner) or not directory:
            return 'Unknown'
        cached = self.runtime_cache.get(owner)
        if cached and time.time() - cached[0] < 8:
            return cached[1]
        query = f'?directory={quote(directory)}'
        try:
            with urlopen(f'http://127.0.0.1:4096/session/{owner}{query}', timeout=1) as response:
                session = json.load(response)
            if session.get('id') != owner or Path(session.get('directory', '')).resolve() != Path(directory).resolve():
                raise ValueError('session mismatch')
            with urlopen(f'http://127.0.0.1:4096/session/status{query}', timeout=1) as response:
                statuses = json.load(response)
            status = statuses.get(owner) or 'idle'
            kind = status.get('type', '') if isinstance(status, dict) else status
            live = {'busy': 'Running', 'idle': 'Idle', 'retry': 'Waiting'}.get(kind, 'Unknown')
        except (OSError, ValueError, KeyError):
            live = 'Unavailable'
        self.runtime_cache[owner] = (time.time(), live)
        return live

    def enqueue(self, lane: str, kind: str, text: str, key: str, revision: str = '') -> dict:
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9-]{8,100}', key):
            raise ValueError('invalid idempotency key')
        if kind not in ('feedback', 'approve', 'preview') or not isinstance(text, str) or len(text) > 2000:
            raise ValueError('invalid action')
        if kind == 'feedback' and not text.strip():
            raise ValueError('feedback required')
        with self.lock:
            existing = self.db.execute('SELECT * FROM actions WHERE id=?', (key,)).fetchone()
            if existing:
                if (existing['lane'], existing['kind'], existing['text'], existing['revision']) != (lane, kind, text, revision):
                    raise ValueError('idempotency key reused for another action')
                return dict(existing)
            row = next((r for r in lane_rows(self.sidecar) if r['lane'] == lane), None)
            if row is None or row.get('status') not in ('active', 'parked', 'ready-for-human'):
                raise ValueError('unknown or inactive lane')
            if kind == 'approve':
                if row['prototype'] or row.get('status') not in ('parked', 'ready-for-human'):
                    raise ValueError('only parked non-prototype work can be approved')
                if not row['revision'] or revision != row['revision']:
                    raise ValueError('reviewed revision changed; refresh before approving')
            elif revision:
                raise ValueError('revision only for approval')
            now = time.time()
            self.db.execute('INSERT INTO actions (id,lane,issue,kind,text,revision,state,created,updated) VALUES (?,?,?,?,?,?,?,?,?)',
                            (key, lane, row.get('issue', ''), kind, text, revision, 'queued', now, now))
            self.db.commit()
            return dict(self.db.execute('SELECT * FROM actions WHERE id=?', (key,)).fetchone())

    def _is_landed(self, revision: str) -> bool:
        try:
            return run('jj', 'log', '--no-graph', '-r', f'ancestors(main) & {revision}',
                       '-T', 'commit_id', cwd=self.sidecar.parent) == revision
        except (OSError, subprocess.SubprocessError):
            return False

    def transition(self, key: str, state: str, error: str = '', result: str = '') -> dict:
        with self.lock:
            row = self.db.execute('SELECT * FROM actions WHERE id=?', (key,)).fetchone()
            if row is None:
                raise ValueError('unknown action')
            allowed = {'queued': {'failed'}, 'dispatched': {'acknowledged', 'failed'},
                       'acknowledged': {'completed', 'failed'}}
            if state not in allowed.get(row['state'], set()):
                raise ValueError('invalid transition')
            if state == 'acknowledged' and row['kind'] == 'approve':
                current = next((r for r in lane_rows(self.sidecar) if r['lane'] == row['lane']), None)
                if not current or current['revision'] != row['revision']:
                    raise ValueError('approval stale; cannot acknowledge')
            if state == 'completed' and row['kind'] == 'approve' and (not result.strip() or not self.is_landed(row['revision'])):
                raise ValueError('approval completion requires landing evidence and reviewed commit in main ancestry')
            self.db.execute('UPDATE actions SET state=?,error=?,result=?,updated=? WHERE id=?',
                            (state, error[:500], result[:1000], time.time(), key))
            self.db.commit()
            return dict(self.db.execute('SELECT * FROM actions WHERE id=?', (key,)).fetchone())

    def retry(self, key: str) -> dict:
        with self.lock:
            row = self.db.execute('SELECT * FROM actions WHERE id=?', (key,)).fetchone()
            if not row or row['state'] != 'failed':
                raise ValueError('only failed actions can be retried')
            if row['kind'] == 'approve':
                current = next((r for r in lane_rows(self.sidecar) if r['lane'] == row['lane']), None)
                if not current or current['revision'] != row['revision']:
                    raise ValueError('approval stale; review again')
            self.db.execute("UPDATE actions SET state='queued',error='',updated=? WHERE id=?", (time.time(), key))
            self.db.commit()
            return dict(row)

    def deliver(self, action: dict) -> str:
        marker = f"Dashboard action {action['id']} ("
        for existing in mail(self.sidecar):
            if existing.get('from') in ('human', 'orchestrator') and existing.get('text', '').startswith(marker):
                return existing['id']
        directive = {'approve': 'Review exact revision and decide whether lane-owned guard.py/land.py may land it; reject if changed. Never auto-land a prototype.',
                     'preview': 'Ask owning lane to start lane_app.py and publish preview-route in LANE.md; do not start a foreign lane yourself.',
                     'feedback': 'Route feedback to owning lane and track iteration.'}[action['kind']]
        message = (f"Dashboard action {action['id']} ({action['kind']}) issue={action['issue']} lane={action['lane']} "
                   f"revision={action['revision'] or 'none'}: {action['text']}\n{directive}\n"
                   f"Acknowledge and complete/fail at {self.dashboard_url or 'the dashboard'} /transition "
                   'using the same action ID; the approval is revision-bound.')
        result = json.loads(run('es', 'mail', 'send', '--as', 'human', '--to', 'project', '--kind', 'learning', '--json', message,
                                cwd=self.sidecar))
        return result.get('id', '') if isinstance(result, dict) else ''

    def dispatch(self) -> None:
        if not self.delivery_lock.acquire(blocking=False):
            return
        try:
            self._dispatch()
        finally:
            self.delivery_lock.release()

    def _dispatch(self) -> None:
        for action in self.actions()[::-1]:
            if action['state'] != 'queued':
                continue
            if action['kind'] == 'approve':
                row = next((r for r in lane_rows(self.sidecar) if r['lane'] == action['lane']), None)
                if not row or row['revision'] != action['revision'] or row['prototype']:
                    self.transition(action['id'], 'failed', 'Approval stale; review current revision')
                    continue
            try:
                mail_id = self.transport(action)
                with self.lock:
                    self.db.execute("UPDATE actions SET state='dispatched',mail_id=?,updated=? WHERE id=? AND state='queued'",
                                    (mail_id, time.time(), action['id']))
                    self.db.commit()
                self.wake(action)
            except (OSError, ValueError, subprocess.SubprocessError) as exc:
                self.transition(action['id'], 'failed', str(exc))

    def wake(self, action: dict) -> None:
        if not self.wake_lock.acquire(blocking=False):
            return
        try:
            if time.time() - self.last_wake < 30:
                return
            self._wake(action)
        finally:
            self.wake_lock.release()

    def _wake(self, action: dict) -> None:
        with self.lock:
            current = self.db.execute('SELECT state,wake_at FROM actions WHERE id=?', (action['id'],)).fetchone()
            if not current or current['state'] != 'dispatched' or current['wake_at']:
                return
        config = self.sidecar / '.review-dashboard/orchestrator.json'
        if not config.exists():
            with self.lock:
                self.db.execute('UPDATE actions SET error=? WHERE id=?',
                                ('Mail delivered; configure orchestrator.json for idle wake', action['id']))
                self.db.commit()
            return
        try:
            target = json.loads(config.read_text())
            sid, directory = target['session'], Path(target['directory']).resolve()
            if not SESSION_RE.fullmatch(sid) or directory not in (self.sidecar.resolve(), self.sidecar.parent.resolve()):
                raise ValueError('invalid orchestrator session/directory')
            if target.get('agent') != 'yolo' or target.get('model') != 'gpt-6-astra':
                raise ValueError('orchestrator must be yolo/openai/gpt-6-astra')
            base = 'http://127.0.0.1:4096'
            query = f'?directory={quote(str(directory))}'
            with urlopen(base + '/session/status' + query, timeout=3) as response:
                status = json.load(response).get(sid)
            if status and (status.get('type') if isinstance(status, dict) else status) != 'idle':
                return
            with urlopen(base + '/session/' + sid + query, timeout=3) as response:
                session = json.load(response)
            if session.get('id') != sid or Path(session.get('directory', '')).resolve() != directory:
                raise ValueError('orchestrator session mismatch')
            with urlopen(base + '/agent' + query, timeout=3) as response:
                agents = json.load(response)
            if not any(agent.get('name') == 'yolo' for agent in agents):
                raise ValueError('orchestrator agent unavailable')
            prompt = (f"Review dashboard action {action['id']} for issue {action.get('issue', 'see lane record')} "
                      f"lane {action['lane']} revision {action['revision'] or 'none'} in es mail project; acknowledge it and process safely.")
            messages_url = base + '/session/' + sid + '/message' + query + '&limit=30'
            def was_accepted():
                with urlopen(messages_url, timeout=4) as response:
                    messages = json.load(response)
                return any(msg.get('info', {}).get('role') == 'user' and
                           any(part.get('type') == 'text' and prompt in part.get('text', '')
                               for part in msg.get('parts', [])) for msg in messages)
            if not was_accepted():
                payload = json.dumps({'agent': 'yolo', 'model': {'providerID': 'openai', 'modelID': 'gpt-6-astra'},
                                      'parts': [{'type': 'text', 'text': prompt}]}).encode()
                request = Request(base + '/session/' + sid + '/prompt_async' + query, data=payload,
                                  headers={'Content-Type': 'application/json'}, method='POST')
                with urlopen(request, timeout=5):
                    pass
                for _ in range(6):
                    if was_accepted():
                        break
                    time.sleep(0.4)
                else:
                    raise ValueError('prompt not confirmed in session messages')
            with self.lock:
                self.db.execute('UPDATE actions SET wake_at=?,error=? WHERE id=?',
                                (time.time(), '', action['id']))
                self.db.commit()
            self.last_wake = time.time()
        except (OSError, ValueError, KeyError) as exc:
            with self.lock:
                self.db.execute('UPDATE actions SET error=?,updated=? WHERE id=?',
                                (f'Mail delivered; wake failed: {exc}'[:500], time.time(), action['id']))
                self.db.commit()

    def wake_pending(self) -> None:
        for action in self.actions():
            if action['state'] == 'dispatched' and not action['wake_at'] and not action['error']:
                self.wake(action)
                if time.time() - self.last_wake < 30:
                    break


def page(desk: Desk) -> str:
    rows, issues, messages = lane_rows(desk.sidecar), desk.issue_rows(), mail(desk.sidecar)
    work = grouped_work(rows, issues, messages)
    actions = desk.actions()
    esc = html.escape
    sections = {'Needs you': [], 'Ready to test': [], 'In progress': []}
    details = []
    for item in work:
        row = item['primary'] or item['participants'][0]
        lane = row['lane']
        issue = item['issue']
        related = item['messages']
        open_questions = item['questions']
        history = [a for a in actions if a['lane'] in {p['lane'] for p in item['participants']}]
        section = item['section']
        title = issue.get('title') or row['summary'] or lane
        short_title = title.split(': ', 1)[1] if ': ' in title else title
        marker = 'question' if open_questions else 'parked' if section == 'Ready to test' else ''
        issue_number = item['number']
        issue_link = (f'<a href="https://github.com/murtaza64/manadj/issues/{esc(issue_number)}" target="_blank" rel="noopener">#{esc(issue_number)}</a>'
                       if issue_number.isdigit() else '<span>untracked</span>')
        activity, activity_age = activity_line(row, messages) if item['primary'] else ('Claimed owner unresolved', '')
        live = desk.runtime(row) if item['primary'] else 'Unknown'
        sections[section].append(f'''<button class="work-row" type="button" data-lane="{esc(item['key'])}" aria-pressed="false">
          <span class="row-top"><span class="row-title">{esc(short_title)}</span><span class="status-mark {marker}">{'?' + str(len(open_questions)) if open_questions or not item['primary'] else 'READY' if marker else 'ACTIVE'}</span></span>
          <span class="row-meta"><span class="activity">{esc(activity)}</span></span>
          <span class="row-footer"><span>{esc(activity_age)}</span><span class="runtime">{esc(live)}</span>
            <span class="signal">{esc('#' + issue_number) if issue_number else 'LANE'} · {len(item['participants'])} lane{'s' if len(item['participants']) != 1 else ''}</span></span></button>''')
        can_approve = bool(item['primary'] and not row['prototype'] and section == 'Ready to test' and row['revision'])
        target_options = ''.join(
            f'<option value="{esc(p["lane"])}" data-preview="{esc(p["preview"])}" data-revision="{esc(p["revision"])}" '
            f'data-can-approve="{str(can_approve and p["lane"] == lane).lower()}" '
            f'{"selected" if item["primary"] and p["lane"] == lane else ""}>{esc(p["lane"])} '
            f'({"owner" if item["primary"] and p["lane"] == lane else "support"})</option>'
            for p in item['participants'])
        if not item['primary']:
            target_options = '<option value="" selected>Select a lane to contact</option>' + target_options
        participants = ''.join(
            f'<li><span class="status">{"OWNER" if item["primary"] and p["lane"] == lane else "SUPPORT"}</span>'
            f'<span class="body"><b>{esc(p["lane"])}</b> · {esc(p.get("status", "unknown"))} '
            f'· {esc(desk.runtime(p))} · {esc(activity_line(p, messages)[1])}'
            f'<br>session {esc(p.get("owner", "unknown"))} · {esc(activity_line(p, messages)[0])}</span></li>'
            for p in item['participants'])
        questions = ''.join(f'<li>{esc(m.get("text", "")[:800])}</li>' for m in open_questions[:5])
        question_section = (f'<section class="detail-section"><h2 class="section-label">Needs your answer · {len(open_questions)}</h2><ul class="question-list">{questions}</ul></section>' if open_questions else '')
        walkthroughs = desk.walkthrough(issue_number) if section == 'Ready to test' else []
        evidence = ''.join(f'<li><span class="status">WALKTHROUGH</span><span class="body">{esc(text)}</span></li>' for text in walkthroughs)
        evidence += ''.join(f'<li><span class="status">{esc(m.get("kind", "MAIL").upper())}</span><span class="body">{esc(m.get("text", "")[:500])}</span></li>' for m in related[:5])
        audit = ''.join(
            f'<li><span class="status {esc(a["state"])}">{esc(a["kind"])} · {esc(a["state"])}</span>'
            f'<span class="body {"stale" if a["kind"] == "approve" and a["state"] != "completed" and a["revision"] != next((p["revision"] for p in item["participants"] if p["lane"] == a["lane"]), "") else ""}">'
            f'{"REVIEWED REVISION CHANGED · " if a["kind"] == "approve" and a["state"] != "completed" and a["revision"] != next((p["revision"] for p in item["participants"] if p["lane"] == a["lane"]), "") else ""}'
            f'{esc(a["text"][:200] or a["revision"][:12] or a["mail_id"])} {esc(a["error"])} {esc(a["result"][:250])}</span>'
            + (f'<button class="btn btn-small" data-retry="{esc(a["id"])}">Retry</button>' if a['state'] == 'failed' else '')
            + (f'<button class="btn btn-small" data-wake="{esc(a["id"])}">Retry wake</button>' if a['state'] == 'dispatched' and a['error'] else '')
            + '</li>' for a in history[:12])
        details.append(f'''<article class="detail" data-lane="{esc(item['key'])}">
          <div class="detail-head"><div class="trail">{issue_link}<span>/</span><span>{esc(lane if item['primary'] else 'owner unresolved')}</span></div>
            <h1>{esc(short_title)}</h1><span class="state {marker}">{esc(section)}{' · question' if open_questions else ''}</span>
          </div><div class="detail-inner">{question_section}
            <section class="detail-section"><h2 class="section-label">Latest owner update · {esc(activity_age)} · {esc(live)}</h2>
              <p class="scope">{esc(activity)}</p></section>
            <section class="detail-section"><h2 class="section-label">Scope</h2>
              <p class="scope">{esc(issue.get('body', '') or row['summary'] or 'No issue summary available.')}</p></section>
            <section class="detail-section"><h2 class="section-label">Participating lanes · {len(item['participants'])}</h2>
              <ul class="history-list">{participants}</ul></section>
            <section class="detail-section"><h2 class="section-label">Working copy</h2><div class="facts">
              <span>OWNER <b>{esc(lane if item['primary'] else 'unresolved')}</b></span>
              <span>CHANGE <b>{esc(row['change'] if item['primary'] else '—')}</b></span>
              <span>REV <b>{esc(row['revision'][:12] if item['primary'] and row['revision'] else 'unavailable')}</b></span>
              <span>TYPE <b>{'prototype · feedback only' if row['prototype'] else 'landable' if item['primary'] else 'unverified'}</b></span>
            </div></section>
            <section class="detail-section"><h2 class="section-label">Review actions</h2>
              <label class="target-label" for="target-{esc(item['key'])}">Route to</label>
              <select class="target-lane" id="target-{esc(item['key'])}">{target_options}</select>
              <div class="action-strip"><a class="btn btn-primary preview-open" href="#" target="_blank" rel="noopener" hidden>Open preview ↗</a>
                <button class="btn btn-primary preview-start" data-kind="preview" hidden>Start preview ↗</button>
                <button class="btn btn-success approval" data-kind="approve" hidden>Approve landing</button></div>
              <p class="action-note">{'Prototype — never lands.' if row['prototype'] else 'Landing approval pins the selected owner revision; the orchestrator performs the gate.'}</p></section>
            <section class="detail-section"><h2 class="section-label">Feedback to owning lane</h2>
              <div class="feedback-form"><textarea placeholder="What should change? Draft stays here during refresh."></textarea>
              <button class="btn btn-primary submit" data-kind="feedback">Send feedback →</button></div></section>
            <section class="detail-section"><h2 class="section-label">Action history</h2>
              <ul class="history-list">{audit or '<li class="muted">No actions yet.</li>'}</ul></section>
            <details class="more-history"><summary>Evidence &amp; lane communication</summary>
              <ul class="history-list">{evidence or '<li class="muted">No walkthrough or mail yet.</li>'}</ul></details>
          </div></article>''')
    groups = ''.join(f'<section class="queue-group" id="{slug}"><div class="queue-heading {slug}"><span>{name}</span><b>{len(cards)}</b></div>'
                     f'{"".join(cards) or "<p class=queue-empty>None waiting here.</p>"}</section>'
                     for name, slug, cards in (('Needs you', 'needs', sections['Needs you']),
                                              ('Ready to test', 'ready', sections['Ready to test']),
                                              ('In progress', 'progress', sections['In progress'])))
    features: dict[str, list[dict]] = {}
    for issue in issues:
        for label in issue['labels']:
            if label.startswith('feature:'):
                features.setdefault(label.removeprefix('feature:'), []).append(issue)
    feature_links = ''.join(
        f'<details><summary><span>{esc(feature)}</span><b>{len(items)}</b></summary>' +
        ''.join(f'<a href="https://github.com/murtaza64/manadj/issues/{i["number"]}" title="{esc(i["title"])}" target="_blank" rel="noopener">#{i["number"]} {esc(i["title"])}</a>' for i in items) +
        '</details>' for feature, items in sorted(features.items()))
    counts = {name: len(cards) for name, cards in sections.items()}
    return f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="review-token" content="{esc(desk.token)}"><title>manadj / review desk</title>
      <link rel="stylesheet" href="/review-dashboard.css"><script src="/review-dashboard.js" defer></script></head>
      <body><header class="app-header"><div class="brand"><strong>manadj</strong><span>/ review desk</span></div>
        <nav class="header-stats"><a href="#needs">Needs you <b>{counts['Needs you']}</b></a>
          <a href="#ready">Ready <b>{counts['Ready to test']}</b></a>
          <a href="#progress">Working <b>{counts['In progress']}</b></a></nav><span class="live">LOCAL</span></header>
      <details class="mobile-feature-menu"><summary>Features · {len(features)} tracked</summary><div class="feature-list">{feature_links}</div></details>
      <main class="shell"><aside class="feature-pane"><div class="pane-heading"><h2>Features</h2><small>{len(features)} tracked</small></div>
        <div class="feature-list">{f'<p class="issue-error">{esc(desk.issue_error)}</p>' if desk.issue_error else ''}{feature_links}</div></aside>
        <section class="queue-pane" aria-label="Work queue"><div class="pane-heading"><h2>Work queue</h2><small>{len(work)} work · {len(rows)} lanes</small></div>{groups}</section>
        <section class="detail-pane" aria-label="Review detail">{''.join(details) or '<div class="pane-heading">No active lanes</div>'}</section>
      </main><div class="notice" id="notice" role="status"></div></body></html>'''


def handler(desk: Desk):
    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status: int, data: dict):
            payload = json.dumps(data).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}':
                self.send_error(403)
                return
            parsed = urlsplit(self.path)
            assets = {'/review-dashboard.css': ('review_dashboard.css', 'text/css; charset=utf-8'),
                      '/review-dashboard.js': ('review_dashboard.js', 'text/javascript; charset=utf-8')}
            if parsed.path in assets:
                name, mime = assets[parsed.path]
                content = (Path(__file__).parent / name).read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return
            if parsed.path in ('/font/regular', '/font/bold'):
                face = 'Regular' if parsed.path == '/font/regular' else 'Bold'
                bundled = REPO / f'frontend/public/fonts/UbuntuMonoNerdFont-{face}.woff2'
                installed = Path.home() / f'Library/Fonts/UbuntuMonoNerdFont-{face}.ttf'
                font = bundled if bundled.is_file() else installed
                if not font.is_file():
                    self.send_error(404)
                    return
                content = font.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'font/woff2' if font.suffix == '.woff2' else 'font/ttf')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return
            if parsed.path in ('/preview', '/preview-status'):
                lane = parse_qs(parsed.query).get('lane', [''])[0]
                row = next((r for r in lane_rows(desk.sidecar) if r['lane'] == lane), None) if LANE_RE.fullmatch(lane) else None
                if not row:
                    self.send_error(404)
                    return
                if parsed.path == '/preview-status':
                    self.send_json(200, {'preview': row['preview']})
                    return
                body = ('''<!doctype html><meta charset="utf-8"><title>Waiting for preview</title>
                    <link rel="stylesheet" href="/review-dashboard.css">
                    <main class="waiting"><span class="eyebrow">LANE PREVIEW</span><h1>Waiting for the owning lane</h1>
                    <p>The preview will open here when ready.</p><p><a class="btn btn-primary" href="/">Back to review desk</a></p></main><script>
                    const lane=''' + json.dumps(lane) + ''';
                    async function check(){try{const r=await fetch('/preview-status?lane='+encodeURIComponent(lane));
                    const data=await r.json();if(data.preview){location.replace(data.preview);return}}catch{}setTimeout(check,2000)}check();
                    </script>''').encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path != '/':
                self.send_error(404)
                return
            body = page(desk).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            origin = self.headers.get('Origin')
            if (self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}'
                    or origin and origin != f'http://127.0.0.1:{self.server.server_port}'
                    or self.headers.get('X-Review-Token') != desk.token
                    or self.headers.get('Content-Type', '').split(';')[0] != 'application/json'):
                self.send_json(403, {'error': 'forbidden'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 5000:
                    raise ValueError('invalid payload size')
                data = json.loads(self.rfile.read(length))
                if self.path == '/action':
                    result = desk.enqueue(data['lane'], data['kind'], data.get('text', ''), data['id'], data.get('revision', ''))
                    desk.dispatch()
                    result = next(a for a in desk.actions() if a['id'] == result['id'])
                elif self.path == '/retry':
                    desk.retry(data['id'])
                    desk.dispatch()
                    result = next(a for a in desk.actions() if a['id'] == data['id'])
                elif self.path == '/transition':
                    result = desk.transition(data['id'], data['state'], data.get('error', ''), data.get('result', ''))
                elif self.path == '/wake':
                    result = next((a for a in desk.actions() if a['id'] == data['id'] and a['state'] == 'dispatched' and a['error']), None)
                    if result is None:
                        raise ValueError('no failed wake to retry')
                    desk.wake(result)
                    result = next(a for a in desk.actions() if a['id'] == data['id'])
                else:
                    self.send_error(404)
                    return
                self.send_json(200, result)
            except (ValueError, KeyError, TypeError) as exc:
                self.send_json(400, {'error': str(exc)})

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8777)
    parser.add_argument('--sidecar', type=Path, default=SIDECAR)
    args = parser.parse_args()
    desk = Desk(args.sidecar)
    desk.token = uuid.uuid4().hex
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(desk))
    desk.dashboard_url = f'http://127.0.0.1:{server.server_port}'
    def poll():
        while True:
            time.sleep(10)
            desk.dispatch()
            desk.wake_pending()
    threading.Thread(target=poll, daemon=True).start()
    print(f'http://127.0.0.1:{server.server_port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
