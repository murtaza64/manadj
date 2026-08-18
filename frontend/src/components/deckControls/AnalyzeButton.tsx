/**
 * Analyze button (deck-controls, curation class): enqueue a `manual`
 * grid+key analysis task for the loaded track and poll it to done
 * (ADR 0003, task-system 01). Extracted from the TagEditor's tempo row so
 * it can ride the beatgrid control row — ONE implementation for every
 * mode, performance included (grid curation happens mid-set).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useTrackAnalysisPending } from '../../hooks/useAnalysisPending';
import './deckControls.css';

export function AnalyzeButton({
  trackId,
  disabled = false,
}: {
  trackId: number | null;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const backgroundAnalyzing = useTrackAnalysisPending(trackId);
  const analysisRunning = isAnalyzing || backgroundAnalyzing;

  const handleAnalyze = async () => {
    if (trackId === null) return;
    const id = trackId;
    setIsAnalyzing(true);
    try {
      let status = await api.analyze.enqueue(id);
      while (status && (status.state === 'pending' || status.state === 'running')) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        status = await api.analyze.status(id);
      }
      if (status?.state === 'failed') {
        console.error('Analysis failed:', status.error);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['beatgrid', id] });
      queryClient.invalidateQueries({ queryKey: ['tracks'] });
      queryClient.invalidateQueries({ queryKey: ['track', id] });
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <button
      onClick={handleAnalyze}
      disabled={disabled || trackId === null || analysisRunning}
      className="player-button deck-analyze"
      title={analysisRunning ? 'Analysis in progress' : 'Analyze grid and key'}
    >
      {analysisRunning ? '…' : 'A'}
    </button>
  );
}
