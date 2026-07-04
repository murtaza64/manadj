.PHONY: dev test typecheck waveforms

dev: frontend/node_modules/.package-lock.json
	uv run scripts/dev.py

# npm creates node_modules/.package-lock.json on install; rebuild when the
# real lockfile (or package.json) is newer.
frontend/node_modules/.package-lock.json: frontend/package.json frontend/package-lock.json
	cd frontend && npm install

test:
	uv run -m pytest

typecheck:
	cd frontend && npx tsc -b

waveforms:
	uv run scripts/populate_waveforms.py


