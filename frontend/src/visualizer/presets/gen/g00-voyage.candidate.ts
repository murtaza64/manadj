/**
 * gen-0 seed: the curated Voyage as a genepool candidate (baseline parent).
 * Brief: none — seeds enter the pool unmodified to anchor the ratings.
 */
import { voyagePreset } from '../voyage';
import type { VisualizerPreset } from '../types';

const candidate: VisualizerPreset = { ...voyagePreset, name: 'g00 Voyage' };
export default candidate;
