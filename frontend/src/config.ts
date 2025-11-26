/**
 * Application configuration
 */

export const config = {
  /**
   * Waveform renderer to use:
   * - 'canvas': Original Canvas-based renderer with real-time drawing
   * - 'png': PNG-based renderer with pre-rendered images
   */
  waveformRenderer: 'png' as 'canvas' | 'png'
};
