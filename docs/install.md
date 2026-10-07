# Installing manaDJ

Requires an Apple Silicon Mac (M1 or later) running a recent macOS.

## Install

1. Download `manaDJ-<version>-arm64.dmg` from the [latest release](https://github.com/murtaza64/manadj/releases).
2. Open the DMG and drag **manaDJ** onto **Applications**.
3. Eject the DMG.

## First launch

manaDJ is not notarized by Apple, so macOS blocks a plain double-click the first time.

1. In Applications, **right-click** (or Control-click) **manaDJ** → **Open**.
2. Click **Open** in the dialog.

If macOS only offers **Move to Trash** / **Done**: open **System Settings → Privacy & Security**,
scroll to "manaDJ was blocked", click **Open Anyway**, and confirm.

After that, manaDJ opens normally. The first launch takes longer while it sets up its database.

## Where your data lives

Everything manaDJ stores is in one folder:

    ~/Library/Application Support/manaDJ

- library database and backups
- settings file (also reachable from Settings → Library → Reveal settings file)
- stems
- logs (Settings → Library → Reveal logs)

Your music files stay where they are; manaDJ only reads them.

## Update

Download the new DMG and drag manaDJ onto Applications again, replacing the old copy. Your data is kept.

## Uninstall

1. Quit manaDJ and drag it from Applications to the Trash.
2. To also remove your library, settings and stems, delete
   `~/Library/Application Support/manaDJ` (Finder → Go → Go to Folder…).

## Problems

If manaDJ shows "manaDJ couldn't start", the window includes the error and the path to the full log
(`~/Library/Application Support/manaDJ/logs/`). Attach that log to an
[issue](https://github.com/murtaza64/manadj/issues).
