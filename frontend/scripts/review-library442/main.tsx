import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Library from '../../src/components/Library';
import { FilterProvider } from '../../src/contexts/FilterContext';
import { DeckProvider, DeckScope } from '../../src/contexts/DeckContext';
import { ToastProvider } from '../../src/components/Toast';
import { installTheme } from '../../src/theme/tokens';
import '../../src/index.css';
import './review.css';

installTheme();
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><FilterProvider><DeckProvider><ToastProvider>
    <main className="integration442"><header><b>442 · Library export integration</b><p>Disposable Library and generated Engine/Rekordbox DB + DAT/EXT. Production adapters, not simulated export receipts. No installed-app, encrypted-library, USB or player verification. Silence fixtures only; playback is outside this review.</p><a href="/source.json" target="_blank">Source / boundaries</a> · <a href="/fixture/evidence" target="_blank">Read fixture DB / native evidence</a></header>
      <DeckScope deck="A"><Library /></DeckScope>
    </main>
  </ToastProvider></DeckProvider></FilterProvider></QueryClientProvider>
);
