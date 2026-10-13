# Local review desk

From a lane workspace: `uv run scripts/agent/review_dashboard.py --port 8777` → `http://127.0.0.1:8777`. The dashboard reads sidecar lane records, live jj working-copy commits, lane app PID/ports, es mail, and a cached GitHub Issues REST list. It does not read or write the app DB. The action queue lives in `.editspace/.review-dashboard/actions.sqlite3` (outside source).

UI assets: `scripts/agent/review_dashboard.css` is a standalone projection of the semantic values in `frontend/src/theme/tokens.ts` (DESIGN.md, gh#199), since this lane predates the design-token change. Buttons and type follow the app's `.btn` and UbuntuMono Nerd Font rules. Fonts come from `frontend/public/fonts/` when present, otherwise this single-developer machine's installed UbuntuMono Nerd Font. The browser selection and unsent feedback drafts survive the 30-second refresh via sessionStorage.

For a custom preview, the owning lane starts `uv run scripts/agent/lane_app.py start` and records `preview-route: /prototype/phone-performance?variant=stack` in its `LANE.md`. The dashboard opens that route on the live Vite port. An independently hosted prototype can instead record `ports: vite=5189` plus `preview-route:` or `preview-url: http://127.0.0.1:PORT/path` (only a live loopback port is linked). When absent, Request preview sends mail to the orchestrator. It never starts another lane's app.

Configure idle wake in `.editspace/.review-dashboard/orchestrator.json`:

```json
{"session":"ses_...","directory":"/Users/murtaza/manadj","agent":"yolo","model":"gpt-6-astra"}
```

Only `openai/gpt-6-astra` is used for wake. No config means mail delivery only, visibly marked. Busy sessions are never prompted; a poll retries idle wake. A failed wake leaves delivered mail and a Retry wake button. Mail originates as `human` so the orchestrator inbox sees it. Never use this dashboard's action endpoint as a landing command.

Actions POST JSON to `/action`: `{id, lane, kind, text, revision}` with `kind=feedback|preview|approve`. `id` is the idempotency key. Approve requires a parked non-prototype lane and the exact displayed jj commit ID; changed commits reject approval before dispatch and before acknowledgment. Actions move through `queued → dispatched → acknowledged → completed|failed`, with `failed → queued` on retry. Dispatch means **mail sent**, not execution. On an idle session wake merely requests orchestrator attention. Request preview opens a waiting tab that switches to the preview when the owning lane publishes it. The orchestrator must decide and record the result explicitly:

```sh
# Obtain the per-process X-Review-Token from the local page; same-origin requests only.
# POST /transition {"id":"...","state":"acknowledged"}
# POST /transition {"id":"...","state":"completed","result":"<land merge/evidence>"} after verification/land;
# or POST /transition {"id":"...","state":"failed","error":"reason"}.
```

Approval messages carry lane and exact commit ID. Orchestrator must re-check that commit, guard/verification, and use the existing **lane-owned** `land.py` path only for eligible work. Completion of an approval requires result evidence and the approved commit in `main` ancestry; post-land lane `@` may have advanced. Prototypes (`tmp:` or `kind: prototype`) never land. Feedback remains actionable for prototypes. No action auto-lands.

The local token is generated on each server start; GET is loopback-only and POST checks Host, Origin, content type and token. Do not expose this process to a public interface or forward its port.

`es-dashboard` in dotfiles provides broad multi-project browsing and AI digests, but its Jira/PR-oriented flow and non-OpenAI digest engines are not used here; this manadj surface is deliberately small and source-free for its durable queue.
