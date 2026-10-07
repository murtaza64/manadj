/** Registers the onboarding lane's Setup guides (setup-guides PRD).
 * Side-effect module: imported once by App. */
import { guideStatus, registerGuide } from '../setup/guides';
import { REKORDBOX_GUIDE_ID } from './guideIds';
import { RekordboxImportGuide } from './RekordboxImportGuide';

registerGuide({
  id: REKORDBOX_GUIDE_ID,
  title: 'Rekordbox import',
  order: 10,
  status: () => guideStatus(REKORDBOX_GUIDE_ID),
  Component: RekordboxImportGuide,
});
