# Plan: Convert Webapp to Electron Desktop App

## Overview

Convert the Music Library Manager from a web application (React + FastAPI) to an Electron desktop application that bundles both frontend and backend into a single distributable package.

## Architecture

### Three-Process Model

**Main Process (Node.js/Electron)**
- Creates and manages BrowserWindow
- Spawns Python backend as child process
- Handles backend lifecycle (start/stop/health checks)
- Provides backend URL to renderer via IPC
- Manages app data directories

**Renderer Process (React)**
- Runs existing React application with minimal changes
- Fetches backend URL via Electron IPC on startup
- Makes standard HTTP requests to local backend

**Backend Process (Python/FastAPI)**
- Spawned by main process on app startup
- Listens on dynamically allocated port (8000-8100 range)
- Bundled as standalone executable via PyInstaller
- Terminates gracefully when app quits

### Communication Flow
```
Renderer (React) <--HTTP fetch()--> Backend (FastAPI)
                                         |
                                    spawned by
                                         |
                                         v
                                  Main Process (Electron)
                                         |
                                   IPC provides
                                   backend URL
```

## Implementation Steps

### 1. Backend Bundling (PyInstaller)

**New File: `backend/backend_server.py`**
- Standalone entry point for backend
- Accepts port as command-line argument
- Reads `DATABASE_PATH` and `WAVEFORMS_PATH` from environment
- Runs uvicorn with configuration

**New File: `backend/backend.spec`**
- PyInstaller spec file
- Includes hidden imports: uvicorn, librosa, scipy, numpy, PIL, sqlalchemy, mutagen, fastapi
- Builds to `backend/dist/backend-server/` directory
- Creates standalone executable with `_internal/` dependencies folder

**Build Command:**
```bash
cd backend
uv run pyinstaller backend.spec --clean
```

**Modified Files:**
- `backend/database.py` (lines 7-11) - Use `DATABASE_PATH` environment variable if set, else fallback to `data/library.db`
  ```python
  import os
  DB_PATH_STR = os.environ.get('DATABASE_PATH')
  if DB_PATH_STR:
      DB_PATH = Path(DB_PATH_STR)
  else:
      DB_PATH = Path(__file__).parent.parent / "data" / "library.db"
  DB_PATH.parent.mkdir(parents=True, exist_ok=True)
  ```

- `backend/main.py` (line 34) - Use `WAVEFORMS_PATH` environment variable for static files mounting
  ```python
  import os
  WAVEFORMS_DIR_STR = os.environ.get('WAVEFORMS_PATH')
  if WAVEFORMS_DIR_STR:
      WAVEFORMS_DIR = Path(WAVEFORMS_DIR_STR)
  else:
      WAVEFORMS_DIR = Path("waveforms")
  WAVEFORMS_DIR.mkdir(parents=True, exist_ok=True)
  app.mount("/waveforms", StaticFiles(directory=str(WAVEFORMS_DIR)), name="waveforms")
  ```

- `backend/crud.py` - Use `WAVEFORMS_PATH` environment variable in `create_waveform()` function
  ```python
  import os
  waveforms_dir_str = os.environ.get('WAVEFORMS_PATH')
  if waveforms_dir_str:
      waveforms_dir = Path(waveforms_dir_str)
  else:
      waveforms_dir = Path("waveforms")
  png_path = waveforms_dir / png_filename
  waveforms_dir.mkdir(parents=True, exist_ok=True)
  ```

### 2. Electron Setup

**New File: `electron/backend-manager.js`**
- Class to manage backend lifecycle
- `start()`: Finds available port, spawns backend process (dev: uv run, prod: bundled executable)
- `waitForReady()`: Polls backend health endpoint until ready
- `stop()`: Gracefully terminates backend with SIGTERM, force kills after 5s timeout
- `getDatabasePath()`: Returns path in `app.getPath('userData')/data/library.db`
- `getWaveformsPath()`: Returns path in `app.getPath('userData')/waveforms/`

**New File: `electron/main.js`**
- Creates BackendManager instance
- Starts backend before creating window
- Creates BrowserWindow with preload script
- Loads frontend (dev: http://localhost:5173, prod: local file)
- Registers IPC handler for `get-backend-url`
- Handles app lifecycle events (quit, activate, before-quit)

**New File: `electron/preload.js`**
- Uses contextBridge to expose `electronAPI` to renderer
- Provides `getBackendUrl()` and `isElectron` flag

### 3. Frontend Integration

**Modified File: `frontend/src/api/client.ts`**
- Lines 3-8: Replace static `BACKEND_URL` initialization with dynamic version
  ```typescript
  const isElectron = () => {
    return typeof window !== 'undefined' && (window as any).electronAPI?.isElectron;
  };

  let BACKEND_URL: string;

  const initBackendUrl = async () => {
    if (isElectron()) {
      BACKEND_URL = await (window as any).electronAPI.getBackendUrl();
    } else {
      BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    }
    return BACKEND_URL;
  };

  if (!isElectron()) {
    BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  }

  const API_BASE = () => `${BACKEND_URL}/api`;

  export { BACKEND_URL, initBackendUrl, API_BASE };
  ```

- Lines 60+: Update all `${API_BASE}/...` references to `${API_BASE()}/...` (28 occurrences throughout the file)

**Modified File: `frontend/src/App.tsx`**
- Add initialization logic before rendering
  ```typescript
  import { useEffect, useState } from 'react';
  import { initBackendUrl } from './api/client';

  function App() {
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
      const init = async () => {
        await initBackendUrl();
        setIsReady(true);
      };
      init();
    }, []);

    if (!isReady) {
      return <div>Loading...</div>;
    }

    // ... existing return statement
  }
  ```

### 4. Build Configuration

**New File: `package.json` (root)**
- Main entry: `electron/main.js`
- Scripts:
  - `electron:dev`: Launches Electron in development mode
  - `build:frontend`: Builds React app via Vite
  - `build:backend`: Runs PyInstaller on backend
  - `build:all`: Builds both + packages with electron-builder
- Dependencies: `get-port`
- DevDependencies: `electron`, `electron-builder`
- electron-builder config:
  - Files: `electron/**/*`, `frontend/dist/**/*`
  - extraResources: `backend/dist/backend-server` → `resources/backend/backend-server`
  - Targets: dmg (macOS), nsis/portable (Windows), AppImage/deb (Linux)

**Modified File: `pyproject.toml`**
- Add optional dependency group `[project.optional-dependencies.build]` with `pyinstaller>=6.0.0`

## Development Workflow

### Development Mode (2 options)

**Option A: Traditional (2 terminals)**
```bash
# Terminal 1: Backend
uv run uvicorn backend.main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend && npm run dev  # Port 5173
```

**Option B: Electron (3 terminals)**
```bash
# Terminal 1: Backend
uv run uvicorn backend.main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend && npm run dev

# Terminal 3: Electron
npm run electron:dev  # Opens Electron window
```

### Production Build
```bash
npm install              # Install Electron dependencies
uv sync --extra build    # Install PyInstaller
npm run build:frontend   # Build React app
npm run build:backend    # Bundle Python backend
npm run electron:build   # Package Electron app
```

**Output:** `dist-electron/MusicLibraryManager-0.1.0.dmg` (or .exe/.AppImage)

## File Changes Summary

### New Files (6)
- `electron/main.js` - Electron main process
- `electron/preload.js` - IPC bridge
- `electron/backend-manager.js` - Backend lifecycle manager
- `backend/backend_server.py` - Standalone backend entry point
- `backend/backend.spec` - PyInstaller configuration
- `package.json` (root) - Electron build config

### Modified Files (6)
- `pyproject.toml` - Add PyInstaller dependency
- `backend/database.py` - Environment variable for database path
- `backend/main.py` - Environment variable for waveforms directory
- `backend/crud.py` - Environment variable for waveforms in create_waveform()
- `frontend/src/api/client.ts` - Electron detection + dynamic backend URL
- `frontend/src/App.tsx` - Initialize backend URL before rendering

## User Requirements

- **Target Platforms:** All platforms (macOS, Windows, Linux)
- **App Size:** 200-500MB acceptable (standard PyInstaller approach)
- **Deployment Mode:** Keep both web and desktop versions (maintain backward compatibility)

## Platform Considerations

**macOS:**
- Code signing required for distribution (Apple Developer $99/yr)
- Notarization required to bypass Gatekeeper
- DMG installer format
- May need JIT entitlements for Python runtime

**Windows:**
- Optional code signing (prevents SmartScreen warnings)
- NSIS installer or portable .exe
- Antivirus may flag PyInstaller executables

**Linux:**
- AppImage (portable) or DEB package
- No code signing needed
- Requires system audio libraries (`libasound2`, `libsndfile1`)

## Backward Compatibility Notes

Since keeping both web and desktop versions:
- Backend must remain compatible with both direct execution (web) and environment variable mode (Electron)
- Frontend must work in both browser and Electron renderer contexts
- All changes should be additive (no removal of existing web functionality)
- Configuration should gracefully fallback to defaults when environment variables are not set

## Key Risks

1. **PyInstaller bundling scientific packages** - librosa/scipy/numpy can be tricky
   - Mitigation: Test early, use comprehensive hiddenimports list

2. **Backend startup time** - May take 5-10 seconds for Python runtime to initialize
   - Mitigation: Show loading screen, consider splash window

3. **Large app size** - Expect 200-500 MB with Python + scientific libraries
   - Mitigation: Normal for music software, use UPX compression

4. **Audio file permissions** - macOS requires explicit library access
   - Mitigation: Request permissions, show clear error messages

## Critical Implementation Files

1. `electron/backend-manager.js` - Core backend lifecycle logic
2. `backend/backend_server.py` - Standalone backend entry point
3. `backend/backend.spec` - PyInstaller bundling config
4. `backend/database.py` - Database path configuration
5. `frontend/src/api/client.ts` - API client with Electron support
