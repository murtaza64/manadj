interface LibraryCloudSummary {
  continuous?: { enabled: boolean; running: boolean; requests: number; sent: number; received: number; error: string | null };
  connection: { enabled: boolean; phase: string; destination: string | null };
  upload: { phase: string; error: string | null; snapshotId?: string; destination?: string;
    bytes?: number; partCount?: number; rowCounts?: Record<string, number>; omissions?: string[];
    reviewID?: string; reviewedSha256?: string; expiresAt?: number };
}
type LibraryCloudResult = { ok: true; value: LibraryCloudSummary } | { ok: false; error: string };
interface LibraryCloudSnapshot { snapshotId: string; state: string; bytes: number; parts: number; createdAt: string }
type LibraryCloudSnapshotsResult = { ok: true; value: LibraryCloudSnapshot[] } | { ok: false; error: string };
type LibraryCloudDeleteResult = { ok: true; value: { deleted: { snapshotId: string; parts: number; bytes: number }; snapshots: LibraryCloudSnapshot[] } } | { ok: false; error: string };
interface LibraryCloudBridge {
  continuousStart?(group: string): Promise<LibraryCloudResult>;
  continuousStop?(): Promise<LibraryCloudResult>;
  state(): Promise<LibraryCloudResult>;
  connect(): Promise<LibraryCloudResult>;
  resume(): Promise<LibraryCloudResult>;
  disconnect(): Promise<LibraryCloudResult>;
  review(): Promise<LibraryCloudResult>;
  upload(review: { reviewID: string; reviewedSha256: string }): Promise<LibraryCloudResult>;
  snapshots(): Promise<LibraryCloudSnapshotsResult>;
  deleteSnapshot(snapshot: { snapshotId: string }): Promise<LibraryCloudDeleteResult>;
  cancel(): Promise<LibraryCloudResult>;
}
interface Window { manadjLibraryCloud?: LibraryCloudBridge; }
