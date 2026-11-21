# In-app feedback

Status: v1 implemented, parked for review in #243 (service #244, form #245).
Service configuration and verification: [feedback-service.md](../agents/feedback-service.md).
Application map and initial standing-area designation remain separate work.

## Capture and filing

- Global Report bug / Request feature action.
- Capture an app screenshot and relevant debugging state before opening the
  form. Let the user describe the issue and preview/remove attachments.
- Include running revision/lane, active view, relevant entity IDs,
  playback/editor state, and bounded recent errors. Do not dump credentials,
  raw storage, or the entire query cache.
- Capture failures must not prevent reporting; identify missing evidence.
- Submission creates a GitHub issue on `murtaza64/manadj` with a sanitized
  summary. Store diagnostic bundles locally, outside disposable lane
  directories, and reference them from the issue. Do not upload raw bundles
  or screenshots automatically.
- Filing and agent dispatch are separate. Filing alone does not authorize
  implementation or agent wake-up; pending reports must not enter an
  actionable agent frontier before dispatch.

## Explicit batches

- Reports accumulate in a durable pending batch per destination. Show the
  destination, pending count, and delivery state in the UI.
- Only Send feedback (N) dispatches. No timeout, navigation, close, restart,
  or agent-idle event implicitly dispatches pending reports.
- Dispatch freezes the batch; subsequently filed reports form a new batch.
- Send one agent message containing the batch's issue links, summaries, and
  diagnostic references. Distinguish pending, queued for delivery, delivered,
  and needs-routing; transport acceptance is not agent acknowledgement.
- An explicitly dispatched batch waits while its receiving agent is busy.
  This delayed delivery does not authorize undispatched reports.
- Dispatch authorizes the agent to act under existing policy: investigate
  and fix bugs, clarify underspecified requests, and park feature work for
  review. It does not authorize landing beyond the existing policy.

## Routing

- Lane app: route directly to the lane's owning agent session, in a batch,
  without a general-triage detour. Capture origin lane, owner, and revision
  with the report; revalidate ownership before delivery.
- Main app: dispatch to triage, which checks duplicates and chooses an
  existing area session or provisions a new lane when appropriate.
- A missing lane/session, changed owner, or uncertain identity requires
  routing review; do not silently retarget or spawn a replacement.
- Never deliver by opening a second session in an owned workspace. Follow
  [standing-area and ownership policy](../agents/parallel-work.md#standing-area-lanes).
- Evidence must remain available to authorized triage/recipient sessions
  without granting access to the real DB or another lane's writable workspace.

## Point, draw, dictate and visible capture context (v2, #518)

- Point at element: the form steps aside and the next click picks any UI
  element without triggering it (the paired click is swallowed; Esc cancels).
  A bounded, redacted descriptor (tag/role/aria-label/short visible
  text/bounds) joins the snapshot as `pointer`; input values, option lists
  and [data-feedback-private] subtrees are never described. The element's
  bounds are highlighted on the screenshot.
- Draw: freehand pen strokes over the captured screenshot (color, undo,
  clear). Strokes stay a working copy baked into the PNG only at filing;
  removing the screenshot removes annotations.
- Dictate: optional speech-to-text into title/description where the runtime
  offers SpeechRecognition. The form discloses browser speech-service
  processing before the mic can start; transcripts land as editable draft
  text only. Microphone audio may be sent to the browser speech service as soon as Dictate starts. Report filing is a separate action, and
  unavailable runtimes keep keyboard/system dictation.
- Visible capture context: the form shows what the capture contains
  (view, playing decks, recent errors, recent events) with a previewable
  bounded trail of recent navigation/playback events (view changes, browse
  view/playlist changes, deck load/play/pause). The trail rides the
  diagnostics snapshot as `trail`; both stay local until explicit dispatch,
  exactly like the rest of the bundle.

## Overlay capture bar (v3, #518)

The popup is no longer the entry point. Feedback opens a small floating
bar over the live app (Editspace-surfaces style, top layer via a manual
popover so it stays reachable above modal dialogs without inerting them):

- Draw is active by default: freehand pen strokes land directly on the
  real app, full screen. Toggling Draw off hands pointer events back to
  the app so the reporter can navigate to the view they mean.
- Point uses the same sanitized element picker from the bar; the picked
  element shows as a chip on the bar.
- Esc or Cancel discards the session without capturing anything.
- Done hides the overlay, waits two frames, then captures screenshot,
  diagnostics and trail, and only then opens the report form with the
  annotated preview for review and filing. Strokes drawn between opening
  the overlay and Done are baked against the pixels captured at Done, so
  app changes mid-session can misalign ink; the form preview shows the
  truth and strokes remain editable there.
- Review, redaction, filing and dispatch semantics are unchanged: text
  only to the tracker, evidence stays local until an explicit batch.

## Deferred

- Automatic bundle retention/deletion; v1 keeps evidence until manually removed.
- Main-app triage session designation; configure an existing recipient rather
  than guessing or spawning one. Unconfigured dispatch requires routing review.
- Automated rerouting/recovery of permanently uncertain writes. V1 preserves
  the evidence and outcome uncertainty instead of risking duplicate actions.
- Application map and initial standing-lane designation. Preserve the agreed
  seven areas in agent guidance; do not fabricate live session assignments.
