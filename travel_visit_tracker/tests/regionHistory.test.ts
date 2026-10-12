import { describe, expect, it } from 'vitest';
import { groupRegionHistory } from '../src/domain/regionHistory';
import { collectionStats } from '../src/domain/collection';
import type { Photo, Visit } from '../src/domain/types';

const visit = (id: string, regionId: string, confirmedAt: number): Visit => ({
  id,
  regionId,
  confirmedAt,
  sessionId: `session-${id}`,
  startedAt: confirmedAt - 300000,
  source: 'gps',
  deletedAt: null,
});
const photo = (id: string, visitId: string, createdAt: number): Photo => ({
  id,
  visitId,
  createdAt,
  uri: `file:///${id}.jpg`,
});

describe('region history', () => {
  it('shows four visits to the same region as one collected region while preserving sessions', () => {
    const visits = [
      visit('a1', 'A', 100),
      visit('a2', 'A', 400),
      visit('a3', 'A', 200),
      visit('a4', 'A', 300),
    ];
    const before = JSON.stringify(visits);
    const result = groupRegionHistory(visits, []);
    expect(result).toHaveLength(1);
    expect(result[0].visits.map((v) => v.id)).toEqual(['a2', 'a4', 'a3', 'a1']);
    expect(result[0].firstVisitedAt).toBe(100);
    expect(result[0].lastVisitedAt).toBe(400);
    expect(collectionStats(visits, new Set(['A', 'B'])).count).toBe(1);
    expect(JSON.stringify(visits)).toBe(before);
  });
  it('orders regions by their latest visit and keeps photos from older sessions', () => {
    const visits = [visit('a1', 'A', 100), visit('b1', 'B', 200), visit('a2', 'A', 300)];
    const photos = [photo('old', 'a1', 110), photo('b', 'b1', 210), photo('new', 'a2', 310)];
    const result = groupRegionHistory(visits, photos);
    expect(result.map((g) => g.regionId)).toEqual(['A', 'B']);
    expect(result[0].photos.map((p) => p.id)).toEqual(['new', 'old']);
    expect(result[1].photos.map((p) => p.id)).toEqual(['b']);
    expect(photos.map((p) => p.id)).toEqual(['old', 'b', 'new']);
  });
  it('retains the region after one session is deleted and removes it after the last deletion', () => {
    const deleted = { ...visit('a1', 'A', 100), deletedAt: 400 };
    const active = visit('a2', 'A', 200);
    const photos = [
      photo('deleted', deleted.id, 110),
      photo('active', active.id, 210),
      photo('orphan', 'missing', 500),
    ];
    const result = groupRegionHistory([deleted, active], photos);
    expect(result).toHaveLength(1);
    expect(result[0].visits.map((v) => v.id)).toEqual(['a2']);
    expect(result[0].photos.map((p) => p.id)).toEqual(['active']);
    expect(result[0].firstVisitedAt).toBe(200);
    expect(groupRegionHistory([deleted, { ...active, deletedAt: 500 }], photos)).toEqual([]);
  });
});
