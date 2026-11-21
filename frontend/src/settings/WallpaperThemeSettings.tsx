import { useState } from 'react';

import {
  disableWallpaperTheme,
  enableWallpaperTheme,
  isWallpaperThemeEnabled,
} from '../theme/wallpaperSource';

/** Wallpaper theme opt-in (gh#470): derive manaDJ's neutral ramp and accent
 * from the desktop wallpaper palette (pywal colors.json on this machine).
 * The backend adapts the palette file; the frontend polls its mtime, so
 * re-running the wallpaper tool updates manaDJ live. Fixed semantic colors
 * (decks, hotcues, stems, energy, status) never change. */
export default function WallpaperThemeSettings() {
  const [enabled, setEnabled] = useState(isWallpaperThemeEnabled());
  return (
    <>
      <div className="settings-section-heading">
        <div>
          <h2>Wallpaper theme</h2>
          <p>Match manaDJ's surfaces and accent to this device's wallpaper palette.</p>
        </div>
      </div>
      <div className="settings-fields">
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              if (e.target.checked) enableWallpaperTheme();
              else disableWallpaperTheme();
              setEnabled(e.target.checked);
            }}
          />{' '}
          Use wallpaper palette (pywal)
        </label>
        <p className="settings-hint">
          Reads the wallpaper tool's palette file on this machine only
          (~/.cache/wal/colors.json); nothing is uploaded or synced. If the
          palette file is missing or malformed, the current theme stays.
          Turning this off restores the default theme.
        </p>
      </div>
    </>
  );
}
