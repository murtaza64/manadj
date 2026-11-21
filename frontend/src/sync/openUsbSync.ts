/** Entry into the USB drives pull flow from playlist surfaces. Carries the
 * playlist the user was looking at so the USB view can highlight its
 * same-name counterpart; highlighting never binds the match (the preview
 * keeps the explicit choice). */
export const OPEN_USB_SYNC_EVENT = 'manadj:open-usb-sync';
export type OpenUsbSyncDetail = { playlistName: string | null };
let pending: OpenUsbSyncDetail | null = null;
export function openUsbSync(playlistName?: string): void {
  pending = { playlistName: playlistName ?? null };
  window.dispatchEvent(new CustomEvent<OpenUsbSyncDetail>(OPEN_USB_SYNC_EVENT, { detail: pending }));
}
/** Consume the entry request (once): the Sync view mounts after the event
 * when the user came from another surface, so the event alone is not enough. */
export function takeUsbSyncFocus(): OpenUsbSyncDetail | null {
  const detail = pending;
  pending = null;
  return detail;
}
