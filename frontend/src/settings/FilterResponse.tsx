import { useState } from 'react';
import { AutoBlurSelect } from '../components/AutoBlurSelect';
import { HFader } from '../components/performance/MixerStrip';
import { useAutomationGhost, useMixer, useMixerValue } from '../hooks/useMixer';
import { CHANNEL_IDS, type ChannelId } from '../playback/mixer';
import { describeSweepFilter, sweepResponseDb } from '../playback/sweepFilter';

export function FilterResponse() {
  const mixer = useMixer();
  const [deckId, setDeckId] = useState<ChannelId>('A');
  const channel = useMixerValue((m) => m.getChannelState(deckId));
  const settings = useMixerValue((m) => m.getFilterSettings());
  const engaged = useMixerValue((m) => m.isAutomationEngaged());
  const ghost = useAutomationGhost(deckId);
  const owned = ghost !== null || engaged;
  const position = ghost?.filter ?? channel.filter;
  const descriptor = describeSweepFilter(settings, position, 48000);
  const frequencies = Float32Array.from({ length: 180 }, (_, i) => 20 * 1000 ** (i / 179));
  const points = sweepResponseDb(settings, position, frequencies, 48000)
    .map((db, i) => `${30 + (i / 179) * 650},${8 + ((24 - Math.max(-60, Math.min(24, db))) / 84) * 140}`)
    .join(' ');

  return (
    <section className="settings-filter-response" aria-label="Filter response diagnostic">
      <div className="settings-section-heading">
        <h3>Frequency response</h3>
        <label className="settings-inline-label">
          Deck
          <AutoBlurSelect aria-label="Filter response deck" value={deckId}
            onChange={(event) => setDeckId(event.target.value as ChannelId)}>
            {CHANNEL_IDS.map((id) => <option key={id}>{id}</option>)}
          </AutoBlurSelect>
        </label>
      </div>
      <div className="settings-filter-sweep">
        <span>Deck filter</span>
        <output>{descriptor.wet === 0 ? 'Dry center' : `${descriptor.type === 'lowpass' ? 'LP' : 'HP'} ${Math.round(descriptor.frequency)} Hz`}</output>
        <HFader id="settings-sweep" ariaLabel="Deck filter"
          label={Number(position.toPrecision(6)).toString()} accent detent
          fill fillColor="var(--accent)"
          min={-1} max={1} step={0.001} defaultValue={0}
          value={position} disabled={owned} onChange={(value) => {
            if (!mixer.isAutomationEngaged()) mixer.setFilter(deckId, value);
          }} />
        <span>Low pass</span>
        <button className="btn btn-mini" disabled={owned} onClick={() => {
          if (!mixer.isAutomationEngaged()) mixer.setFilter(deckId, 0);
        }}>Center</button>
        <span>High pass</span>
      </div>
      <svg className="settings-response" viewBox="0 0 700 172" role="img" aria-label="Filter frequency response">
        {[24, 0, -24, -48].map((db) => (
          <g key={db}>
            <line x1="30" x2="680" y1={8 + ((24 - db) / 84) * 140} y2={8 + ((24 - db) / 84) * 140} />
            <text x="0" y={12 + ((24 - db) / 84) * 140}>{db}</text>
          </g>
        ))}
        {[20, 100, 1000, 10000, 20000].map((f) => (
          <text key={f} x={30 + (Math.log(f / 20) / Math.log(1000)) * 650} y="169" textAnchor={f === 20000 ? 'end' : 'start'}>
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        ))}
        <polyline points={points} />
      </svg>
      <p className="settings-hint">Target response at 48 kHz, including resonance trim. Excludes drive and output limiting.</p>
      {owned && <p className="settings-hint">Automation owns the filter sweep. Preferences still apply live.</p>}
    </section>
  );
}
