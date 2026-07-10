.PHONY: dev dev-app app electron test typecheck waveforms

PORT ?= 5173

dev: frontend/node_modules/.package-lock.json
	uv run scripts/dev.py

# Everything in one command: backend + frontend + desktop shell.
# Quitting the window (Cmd+Q) shuts the servers down too.
dev-app: frontend/node_modules/.package-lock.json desktop/node_modules/.package-lock.json
	desktop/ensure-electron.sh
	uv run scripts/dev.py --app

# npm creates node_modules/.package-lock.json on install; rebuild when the
# real lockfile (or package.json) is newer.
frontend/node_modules/.package-lock.json: frontend/package.json frontend/package-lock.json
	cd frontend && npm install

# Desktop shell (attach-only Electron window; see desktop/README.md).
# Attaches to a running `make dev` at PORT (default 5173), or a lane app:
#   make electron PORT=<lane vite port>
# Electron is the preferred venue for user-testing Walkthroughs (Firefox
# has known audio breakage — headphone-cue 08).
app: desktop/node_modules/.package-lock.json
	desktop/ensure-electron.sh
	cd desktop && npx electron . --port $(PORT)

electron: app

desktop/node_modules/.package-lock.json: desktop/package.json desktop/package-lock.json
	cd desktop && npm install

test:
	uv run -m pytest

typecheck:
	cd frontend && npx tsc -b

waveforms:
	uv run scripts/populate_waveforms.py


