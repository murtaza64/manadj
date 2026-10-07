/** Registers the onboarding lane's Setup guides (setup-guides PRD).
 * Side-effect module: imported once by App. */
import { guideStatus, registerGuide } from '../setup/guides';
import { REKORDBOX_GUIDE_ID, TRACKS_DIRECTORY_GUIDE_ID } from './guideIds';
import { RekordboxImportGuide } from './RekordboxImportGuide';
import { TracksDirectoryGuide } from './TracksDirectoryGuide';

registerGuide({
  id: REKORDBOX_GUIDE_ID,
  title: 'Rekordbox import',
  order: 10,
  status: () => guideStatus(REKORDBOX_GUIDE_ID),
  Component: RekordboxImportGuide,
});

registerGuide({
  id: TRACKS_DIRECTORY_GUIDE_ID,
  title: 'Tracks directory',
  order: 20,
  status: () => guideStatus(TRACKS_DIRECTORY_GUIDE_ID),
  Component: TracksDirectoryGuide,
});
