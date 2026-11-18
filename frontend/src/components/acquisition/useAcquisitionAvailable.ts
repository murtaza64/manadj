// Gate for the Acquisition tab: visible when a wishlist Source is
// connected — SoundCloud (likes) or Spotify ("want" items).
import { useQuery } from '@tanstack/react-query';
import { SOUNDCLOUD_STATUS_KEY, soundcloudApi } from '../../setup/soundcloud/soundcloudApi';
import { SPOTIFY_STATUS_KEY, spotifyApi } from '../../setup/spotify/spotifyApi';

export function useAcquisitionAvailable(): boolean {
  const soundcloud = useQuery({
    queryKey: SOUNDCLOUD_STATUS_KEY,
    queryFn: () => soundcloudApi.status(),
    staleTime: 5 * 60 * 1000,
  });
  const spotify = useQuery({
    queryKey: SPOTIFY_STATUS_KEY,
    queryFn: () => spotifyApi.status(),
    staleTime: 5 * 60 * 1000,
  });
  return (soundcloud.data?.connected ?? false) || spotify.data?.state === 'connected';
}