import type { Candidate, LocationSample, TrackingStatus } from './types';

// Initial conservative policy; actual device measurements must validate these values.
export const dwellPolicy = {
  dwellMs: 300_000,
  maxGapMs: 120_000,
  maxAgeMs: 120_000,
  maxAccuracyM: 50,
  futureToleranceMs: 30_000,
};
export type Observation = LocationSample & { regionId: string | null; boundaryDistanceM: number };
export type DwellResult = {
  candidate: Candidate | null;
  confirmed: Candidate | null;
  status: TrackingStatus;
  message: string;
};

export function advanceDwell(
  previous: Candidate | null,
  sample: Observation,
  now: number,
  newId: () => string,
): DwellResult {
  const uncertain = (message: string): DwellResult => ({
    candidate: null,
    confirmed: null,
    status: 'uncertain',
    message,
  });
  if (
    ![sample.longitude, sample.latitude, sample.accuracy, sample.timestamp, now].every(
      Number.isFinite,
    ) ||
    Math.abs(sample.longitude) > 180 ||
    Math.abs(sample.latitude) > 90 ||
    sample.accuracy < 0
  )
    return uncertain('올바른 위치를 기다리는 중');
  if (previous && previous.lastObservedAt > now + dwellPolicy.futureToleranceMs)
    return uncertain('휴대폰 시각이 변경되어 체류 시간을 다시 확인합니다');
  // A delayed duplicate must not invalidate newer observations already processed.
  if (previous && sample.timestamp <= previous.lastObservedAt)
    return {
      candidate: previous,
      confirmed: null,
      status: previous.confirmedAt === null ? 'candidate' : 'confirmed',
      message: '다음 위치를 기다리는 중',
    };
  if (
    sample.timestamp > now + dwellPolicy.futureToleranceMs ||
    now - sample.timestamp > dwellPolicy.maxAgeMs
  )
    return uncertain('위치 수신이 지연되어 체류 시간을 다시 확인합니다');
  if (sample.accuracy > dwellPolicy.maxAccuracyM || sample.boundaryDistanceM < sample.accuracy)
    return uncertain('위치가 불확실합니다. 경계에서 벗어나면 다시 확인합니다');
  if (!sample.regionId)
    return {
      candidate: null,
      confirmed: null,
      status: 'outside',
      message: '이 경계 팩에 포함된 지역 밖입니다',
    };
  const sameSession =
    previous?.regionId === sample.regionId &&
    sample.timestamp - previous.lastObservedAt <= dwellPolicy.maxGapMs;
  const candidate: Candidate = sameSession
    ? { ...previous!, lastObservedAt: sample.timestamp }
    : {
        id: newId(),
        regionId: sample.regionId,
        startedAt: sample.timestamp,
        lastObservedAt: sample.timestamp,
        confirmedAt: null,
      };
  if (
    candidate.confirmedAt === null &&
    candidate.lastObservedAt - candidate.startedAt >= dwellPolicy.dwellMs
  ) {
    candidate.confirmedAt = sample.timestamp;
    return {
      candidate,
      confirmed: candidate,
      status: 'confirmed',
      message: '새로운 방문을 지도에 기록했습니다',
    };
  }
  return {
    candidate,
    confirmed: null,
    status: candidate.confirmedAt === null ? 'candidate' : 'confirmed',
    message:
      candidate.confirmedAt === null
        ? '5분 동안 머무르면 방문으로 기록됩니다'
        : '방문한 지역에 머무는 중',
  };
}
