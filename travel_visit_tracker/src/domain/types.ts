import type { Feature, MultiPolygon, Polygon } from 'geojson';

export type RegionFeature = Feature<
  Polygon | MultiPolygon,
  { regionId: string; name: string; sourceName: string }
>;
export type Region = {
  id: string;
  name: string;
  sourceName: string;
  feature: RegionFeature;
  bounds: [number, number, number, number];
};
export type LocationSample = {
  longitude: number;
  latitude: number;
  accuracy: number;
  timestamp: number;
};
export type Candidate = {
  id: string;
  regionId: string;
  startedAt: number;
  lastObservedAt: number;
  confirmedAt: number | null;
};
export type Visit = {
  id: string;
  sessionId: string;
  regionId: string;
  startedAt: number;
  confirmedAt: number;
  source: 'gps' | 'development';
  deletedAt: number | null;
};
export type Photo = { id: string; visitId: string; uri: string; createdAt: number };
export type TrackingStatus =
  'off' | 'waiting' | 'candidate' | 'confirmed' | 'uncertain' | 'outside';
export type TrackingDiagnostics = {
  lastSampleAt: number | null;
  accuracyM: number | null;
  gapMs: number | null;
  delayMs: number | null;
  lastResetAt: number | null;
  lastResetReason: string | null;
  collectorMode: 'off' | 'foreground' | 'background';
};
export type AppSnapshot = {
  visits: Visit[];
  photos: Photo[];
  candidate: Candidate | null;
  recording: boolean;
  recordingMode: 'foreground' | 'background';
  status: TrackingStatus;
  message: string;
  pending: number;
  diagnostics: TrackingDiagnostics;
};
