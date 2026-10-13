import { guideStatus, registerGuide } from '../guides';
import { CUE_MODE_GUIDE_ID, CueModeGuide } from './CueModeGuide';

registerGuide({
  id: CUE_MODE_GUIDE_ID,
  title: 'Cue mode',
  order: 30,
  status: () => guideStatus(CUE_MODE_GUIDE_ID),
  Component: CueModeGuide,
});
