import { expect, it } from 'vitest';
import { completePlaylistExportReceipt } from './playlistExportReceipt';
import { exportPlanFixture, exportReportFixture } from '../test/playlistExportFixtures';

it('requires a bounded addition receipt when the plan creates records', () => {
  const plan = structuredClone(exportPlanFixture);
  plan.tracks[2].record_action = 'create';
  const report = structuredClone(exportReportFixture);
  expect(completePlaylistExportReceipt(report, plan)).toBe(false);
  report.results[0].tracks_added = ['c.flac'];
  expect(completePlaylistExportReceipt(report, plan)).toBe(true);
  report.results[0].tracks_added = ['unplanned.flac'];
  expect(completePlaylistExportReceipt(report, plan)).toBe(false);
  report.results[0].tracks_added = ['c.flac', 'c.flac'];
  expect(completePlaylistExportReceipt(report, plan)).toBe(false);
  report.results[0].tracks_added = [];
  expect(completePlaylistExportReceipt(report, plan)).toBe(true);
});

it('rejects malformed addition evidence instead of hiding it as a successful export', () => {
  const report = structuredClone(exportReportFixture);
  expect(completePlaylistExportReceipt({ ...report, results: [{ ...report.results[0], tracks_added: [{}] }] }, exportPlanFixture)).toBe(false);
});
