import type { Photo, Visit } from './types';

export type RegionHistory = {
  regionId: string;
  visits: Visit[];
  photos: Photo[];
  firstVisitedAt: number;
  lastVisitedAt: number;
};

export function groupRegionHistory(visits: Visit[], photos: Photo[]): RegionHistory[] {
  const groups = new Map<string, RegionHistory>();
  const visitRegions = new Map<string, string>();
  for (const visit of visits) {
    if (visit.deletedAt !== null) continue;
    let group = groups.get(visit.regionId);
    if (!group) {
      group = {
        regionId: visit.regionId,
        visits: [],
        photos: [],
        firstVisitedAt: visit.confirmedAt,
        lastVisitedAt: visit.confirmedAt,
      };
      groups.set(visit.regionId, group);
    }
    group.visits.push(visit);
    group.firstVisitedAt = Math.min(group.firstVisitedAt, visit.confirmedAt);
    group.lastVisitedAt = Math.max(group.lastVisitedAt, visit.confirmedAt);
    visitRegions.set(visit.id, visit.regionId);
  }
  for (const photo of photos) {
    const regionId = visitRegions.get(photo.visitId);
    if (regionId !== undefined) groups.get(regionId)!.photos.push(photo);
  }
  for (const group of groups.values()) {
    group.visits.sort((a, b) => b.confirmedAt - a.confirmedAt || a.id.localeCompare(b.id));
    group.photos.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }
  return [...groups.values()].sort(
    (a, b) => b.lastVisitedAt - a.lastVisitedAt || a.regionId.localeCompare(b.regionId),
  );
}
