import type { Visit } from './types';
export const badgeDefinitions = [
  { id: 'first', threshold: 1, name: '첫 발자국', description: '첫 지역을 색칠했어요' },
  { id: 'ten', threshold: 10, name: '동네 탐험가', description: '10개 지역을 방문했어요' },
  { id: 'fifty', threshold: 50, name: '여행 수집가', description: '50개 지역을 방문했어요' },
  { id: 'hundred', threshold: 100, name: '지도 개척자', description: '100개 지역을 방문했어요' },
];
export function collectionStats(visits: Visit[], packRegionIds: Set<string>) {
  const active = visits.filter((v) => v.deletedAt === null && packRegionIds.has(v.regionId));
  const visited = new Set(active.map((v) => v.regionId));
  return {
    visited,
    count: visited.size,
    total: packRegionIds.size,
    percentage: packRegionIds.size ? (visited.size / packRegionIds.size) * 100 : 0,
    badges: badgeDefinitions.map((b) => ({ ...b, earned: visited.size >= b.threshold })),
  };
}
