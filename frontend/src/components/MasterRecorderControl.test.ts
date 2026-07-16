import { describe, expect, it } from 'vitest';
import { formatRecordingElapsed } from '../recording/recordingTime';

describe('master recorder elapsed label', () => {
  it('formats elapsed wall time as minutes and seconds', () => {
    expect(formatRecordingElapsed(0)).toBe('0:00');
    expect(formatRecordingElapsed(65_900)).toBe('1:05');
  });
});
