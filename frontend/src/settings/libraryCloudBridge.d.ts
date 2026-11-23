interface LibraryCloudSummary {
  connection: { enabled: boolean; phase: string; destination: string | null };
  upload: { phase: string; error: string | null; snapshotId?: string; destination?: string;
    bytes?: number; partCount?: number; rowCounts?: Record<string, number>; omissions?: string[];
    reviewID?: string; reviewedSha256?: string; expiresAt?: number };
}
type LibraryCloudResult = { ok: true; value: LibraryCloudSummary } | { ok: false; error: string };
interface LibraryCloudBridge {
  state(): Promise<LibraryCloudResult>;
  connect(): Promise<LibraryCloudResult>;
  resume(): Promise<LibraryCloudResult>;
  disconnect(): Promise<LibraryCloudResult>;
  review(): Promise<LibraryCloudResult>;
  upload(review: { reviewID: string; reviewedSha256: string }): Promise<LibraryCloudResult>;
  cancel(): Promise<LibraryCloudResult>;
}
interface Window { manadjLibraryCloud?: LibraryCloudBridge; }
