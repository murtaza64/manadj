import { describe, expect, it } from 'vitest';
import { suggestedRecordingName } from './masterRecording';

describe('master recording filename', () => {
  it('uses a filesystem-safe local recording label', () => {
    expect(suggestedRecordingName(new Date('2026-07-16T20:30:45Z'))).toBe(
      'manaDJ 2026-07-16 20-30-45'
    );
  });
});
