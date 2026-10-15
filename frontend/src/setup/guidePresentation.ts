/** Host-owned copy: guide modules retain their small registration contract. */
const COPY: Record<string, { description: string; category: string }> = {
  'rekordbox-import': { category: 'Your music', description: 'Bring your tracks, cues and playlists with you.' },
  'tracks-directory': { category: 'Your music', description: 'Choose a music folder. Include its subfolders in a Scan.' },
  'cue-mode': { category: 'How you play', description: 'Choose how Hot Cues behave when a deck is paused.' },
  soundcloud: { category: 'Optional accounts', description: 'Connect your SoundCloud likes for finding music.' },
  spotify: { category: 'Optional accounts', description: 'Browse your Spotify likes and playlists for tracks to get.' },
  soulseek: { category: 'Optional accounts', description: 'Connect Soulseek for downloading tracks.' },
  'controller-check': { category: 'Your equipment', description: 'Check your speakers, headphones and controller.' },
};

export function guidePresentation(id: string) {
  return COPY[id] ?? { category: 'Setup', description: 'Optional. You can return to this guide in Settings → Setup.' };
}
