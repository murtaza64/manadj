import { createRoot } from 'react-dom/client';
import { ReleaseNotes, ReleaseNotesButton } from './ReleaseNotes';

createRoot(document.getElementById('root')!).render(<>
  <h1>Release notes — isolated review</h1>
  <p>Sample loaded release. No library, playback engine, updater or production bootstrap.</p>
  <p>Done saves a receipt in this venue’s decoy data root. Reload: no automatic popup. Reopen manually:</p>
  <ReleaseNotesButton />
  <ReleaseNotes />
</>);
