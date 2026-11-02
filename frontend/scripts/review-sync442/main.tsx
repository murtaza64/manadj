import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { installTheme } from '../../src/theme/tokens';
import { skipAllTours } from '../../src/tour/tourState';
import '../../src/index.css';
import './review.css';

installTheme();
skipAllTours(); // Unrelated onboarding chrome is outside this fixture review.
createRoot(document.getElementById('root')!).render(<div className="review-sync442">
  <header><b>#442 · actual SYNC workspace revision</b><p>Production App/Sync navigation; real adapters on disposable Library/Engine/Rekordbox/native fixtures. No installed/private-library/USB/device writes. EXPORT remains accessible for comparison; phone/peer setup is still Settings-owned.</p><a href="/source.json" target="_blank">Source / fixture boundary</a> · <a href="/fixture/evidence" target="_blank">Actual fixture evidence</a></header>
  <App />
</div>);
