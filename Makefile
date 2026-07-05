.PHONY: dev app test typecheck waveforms

PORT ?= 5173

dev: frontend/node_modules/.package-lock.json
	uv run scripts/dev.py

# npm creates node_modules/.package-lock.json on install; rebuild when the
# real lockfile (or package.json) is newer.
frontend/node_modules/.package-lock.json: frontend/package.json frontend/package-lock.json
	cd frontend && npm install

# Desktop shell (attach-only Electron window; see desktop/README.md).
# Attaches to a running `make dev` at PORT (default 5173).
app: desktop/node_modules/.package-lock.json
	cd desktop && npx electron . --port $(PORT)

desktop/node_modules/.package-lock.json: desktop/package.json desktop/package-lock.json
	cd desktop && npm install

test:
	uv run -m pytest

typecheck:
	cd frontend && npx tsc -b

waveforms:
	uv run scripts/populate_waveforms.py


