# Installing manaDJ

- **macOS:** Apple Silicon Mac (M1 or later), recent macOS.
- **Windows:** 64-bit Windows 10 or 11 (x64). Untested on Windows hardware so far — reports welcome.

## Install (macOS)

1. Download `manaDJ-<version>-arm64.dmg` from the [latest release](https://github.com/murtaza64/manadj/releases).
2. Open the DMG and drag **manaDJ** onto **Applications**.
3. Eject the DMG.

## First launch (macOS)

manaDJ is not notarized by Apple, so macOS blocks a plain double-click the first time.

1. In Applications, **right-click** (or Control-click) **manaDJ** → **Open**.
2. Click **Open** in the dialog.

If macOS only offers **Move to Trash** / **Done**: open **System Settings → Privacy & Security**,
scroll to "manaDJ was blocked", click **Open Anyway**, and confirm.

After that, manaDJ opens normally. The first launch takes longer while it sets up its database.

## Install (Windows)

1. Download `manaDJ-<version>-x64-setup.exe` from the [latest release](https://github.com/murtaza64/manadj/releases).
2. Run it. manaDJ isn't code-signed yet, so Windows shows **Windows protected your PC**:
   click **More info** → **Run anyway**.
3. The installer needs no administrator rights; it installs to
   `%LOCALAPPDATA%\Programs\manaDJ` and adds a Start menu entry.

If Smart App Control blocks the installer outright (Windows 11), it can't be bypassed per
app; use a machine with Smart App Control off until manaDJ is signed.

## Where your data lives

Everything manaDJ stores is in one folder:

    macOS:    ~/Library/Application Support/manaDJ
    Windows:  %APPDATA%\manaDJ

- library database and backups
- settings file (also reachable from Settings → Library → Reveal settings file)
- stems
- logs (Settings → Library → Reveal logs)

Your music files stay where they are; manaDJ only reads them.

## Update

- macOS: download the new DMG and drag manaDJ onto Applications again, replacing the old copy.
- Windows: run the new installer over the old one.

Your data is kept.

## Uninstall

- macOS: quit manaDJ and drag it from Applications to the Trash.
- Windows: Settings → Apps → Installed apps → manaDJ → Uninstall.

To also remove your library, settings and stems, delete the data folder above
(macOS: Finder → Go → Go to Folder…; Windows: paste `%APPDATA%\manaDJ` into Explorer).

## Problems

If manaDJ shows "manaDJ couldn't start", the window includes the error and the path to the full log
(`logs` inside the data folder). Attach that log to an
[issue](https://github.com/murtaza64/manadj/issues).
