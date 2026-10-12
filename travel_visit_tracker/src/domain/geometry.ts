import type { Position, Polygon, MultiPolygon } from 'geojson';

function segmentDistance(p: Position, a: Position, b: Position): number {
  const xScale = 111320 * Math.cos((p[1] * Math.PI) / 180);
  const ax = (a[0] - p[0]) * xScale,
    ay = (a[1] - p[1]) * 111320;
  const bx = (b[0] - p[0]) * xScale,
    by = (b[1] - p[1]) * 111320;
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function insideRing(p: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i];
    if (segmentDistance(p, a, b) < 0.001) return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

export function containsPoint(p: Position, geometry: Polygon | MultiPolygon): boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(
    (rings) => insideRing(p, rings[0]) && !rings.slice(1).some((hole) => insideRing(p, hole)),
  );
}

export function boundaryDistance(p: Position, geometry: Polygon | MultiPolygon): number {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let distance = Infinity;
  for (const rings of polygons)
    for (const ring of rings)
      for (let i = 1; i < ring.length; i++)
        distance = Math.min(distance, segmentDistance(p, ring[i - 1], ring[i]));
  return distance;
}

export function geometryBounds(geometry: Polygon | MultiPolygon): [number, number, number, number] {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rings of polygons)
    for (const ring of rings)
      for (const p of ring) {
        bounds[0] = Math.min(bounds[0], p[0]);
        bounds[1] = Math.min(bounds[1], p[1]);
        bounds[2] = Math.max(bounds[2], p[0]);
        bounds[3] = Math.max(bounds[3], p[1]);
      }
  return bounds;
}
