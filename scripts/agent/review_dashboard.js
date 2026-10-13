const token = document.querySelector('meta[name="review-token"]').content;
const rows = [...document.querySelectorAll('.work-row')];
const details = [...document.querySelectorAll('.detail')];
const draftKey = (lane) => `manadj-review-draft:${lane}`;

function selectLane(lane, resetDetail = false) {
  for (const row of rows) {
    const selected = row.dataset.lane === lane;
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-pressed', String(selected));
  }
  for (const detail of details) detail.classList.toggle('selected', detail.dataset.lane === lane);
  sessionStorage.setItem('manadj-review-selection', lane);
  if (resetDetail) document.querySelector('.detail-pane').scrollTop = 0;
}

for (const row of rows) row.addEventListener('click', () => selectLane(row.dataset.lane, true));
for (const detail of details) {
  const target = detail.querySelector('.target-lane');
  const savedTarget = sessionStorage.getItem(`manadj-review-target:${detail.dataset.lane}`);
  if (savedTarget && [...target.options].some(option => option.value === savedTarget)) target.value = savedTarget;
  const updateTarget = () => {
    const option = target.selectedOptions[0];
    const preview = option.dataset.preview || '';
    const link = detail.querySelector('.preview-open');
    link.hidden = !preview;
    if (preview) link.href = preview;
    detail.querySelector('.preview-start').hidden = !target.value || Boolean(preview);
    const approval = detail.querySelector('.approval');
    approval.hidden = option.dataset.canApprove !== 'true';
    approval.dataset.rev = option.dataset.revision || '';
    sessionStorage.setItem(`manadj-review-target:${detail.dataset.lane}`, target.value);
  };
  target.addEventListener('change', updateTarget);
  updateTarget();
  const textarea = detail.querySelector('textarea');
  if (!textarea) continue;
  textarea.value = sessionStorage.getItem(draftKey(detail.dataset.lane)) || '';
  textarea.addEventListener('input', () => sessionStorage.setItem(draftKey(detail.dataset.lane), textarea.value));
}
const remembered = sessionStorage.getItem('manadj-review-selection');
selectLane(rows.some(row => row.dataset.lane === remembered) ? remembered : rows[0]?.dataset.lane || '');
const panes = ['.feature-pane', '.queue-pane', '.detail-pane', '.mobile-feature-menu .feature-list'];
for (const selector of panes) {
  const pane = document.querySelector(selector);
  if (!pane) continue;
  const key = `manadj-review-scroll:${selector}`;
  pane.scrollTop = Number(sessionStorage.getItem(key) || 0);
  pane.addEventListener('scroll', () => sessionStorage.setItem(key, String(pane.scrollTop)), { passive: true });
}
const focus = sessionStorage.getItem('manadj-review-focus');
if (focus) {
  if (focus.startsWith('lane:')) rows.find(row => row.dataset.lane === focus.slice(5))?.focus({ preventScroll: true });
  if (focus.startsWith('action:')) [...document.querySelectorAll('.detail.selected button[data-kind]')]
    .find(button => button.dataset.kind === focus.slice(7))?.focus({ preventScroll: true });
  sessionStorage.removeItem('manadj-review-focus');
}

let sending = false;
async function send(url, data) {
  sending = true;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Review-Token': token },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    const notice = document.getElementById('notice');
    notice.textContent = response.ok ? `${result.kind || 'Action'} · ${result.state}` : result.error || 'Request failed';
    if (response.ok) setTimeout(() => location.reload(), 1200);
    return response.ok;
  } catch {
    document.getElementById('notice').textContent = 'Connection unavailable. Your feedback is still here.';
    return false;
  } finally {
    sending = false;
  }
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-kind], button[data-retry], button[data-wake]');
  if (!button) return;
  if (button.dataset.retry) return void send('/retry', { id: button.dataset.retry });
  if (button.dataset.wake) return void send('/wake', { id: button.dataset.wake });
  const detail = button.closest('.detail');
  const lane = detail.querySelector('.target-lane').value;
  if (!lane) {
    document.getElementById('notice').textContent = 'Select the lane to contact first.';
    return;
  }
  const kind = button.dataset.kind;
  const textarea = detail.querySelector('textarea');
  const text = kind === 'feedback' ? textarea.value.trim() : '';
  if (kind === 'feedback' && !text) {
    textarea.focus();
    return;
  }
  if (kind === 'approve' && !confirm(`Approve exactly ${button.dataset.rev} for ${lane}?`)) return;
  const waiting = kind === 'preview' ? window.open(`/preview?lane=${encodeURIComponent(lane)}`, '_blank') : null;
  const ok = await send('/action', { id: crypto.randomUUID(), lane, kind, text, revision: button.dataset.rev || '' });
  if (ok && kind === 'feedback') {
    textarea.value = '';
    sessionStorage.removeItem(draftKey(lane));
  }
  if (!ok && waiting) waiting.close();
});

setInterval(() => {
  if (sending || document.activeElement?.tagName === 'TEXTAREA') return;
  const active = document.activeElement;
  if (active?.classList.contains('work-row')) sessionStorage.setItem('manadj-review-focus', `lane:${active.dataset.lane}`);
  else if (active?.dataset.kind) sessionStorage.setItem('manadj-review-focus', `action:${active.dataset.kind}`);
  location.reload();
}, 30000);
