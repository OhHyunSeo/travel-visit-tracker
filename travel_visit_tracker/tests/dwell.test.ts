import { describe, expect, it } from 'vitest';
import { advanceDwell, type Observation } from '../src/domain/dwell';
import type { Candidate } from '../src/domain/types';
const start = 1_000_000;
function sample(delta: number, patch: Partial<Observation> = {}): Observation {
  return {
    longitude: 127,
    latitude: 37,
    accuracy: 10,
    timestamp: start + delta,
    regionId: 'A',
    boundaryDistanceM: 500,
    ...patch,
  };
}
function step(
  previous: Candidate | null,
  delta: number,
  patch: Partial<Observation> = {},
  now = start + delta,
) {
  return advanceDwell(previous, sample(delta, patch), now, () => `session-${delta}`);
}
function at(delta: number) {
  let candidate: Candidate | null = null;
  for (let t = 0; t < delta; t += 60000) candidate = step(candidate, t).candidate;
  return step(candidate, delta);
}
describe('observed continuous five-minute dwell', () => {
  it('resets a candidate when the device clock moves backwards', () => {
    const candidate = at(240000).candidate;
    expect(step(candidate, 120000).status).toBe('uncertain');
  });
  it('does not confirm at 299 seconds', () => expect(at(299000).confirmed).toBeNull());
  it('confirms at 300 seconds', () =>
    expect(at(300000).confirmed?.confirmedAt).toBe(start + 300000));
  it('confirms only once during the same continuous session', () => {
    const result = at(300000);
    expect(step(result.candidate, 360000).confirmed).toBeNull();
  });
  it('ignores duplicate and out-of-order observations', () => {
    const candidate = step(step(null, 0).candidate, 60000).candidate;
    expect(step(candidate, 60000).candidate).toEqual(candidate);
    expect(step(candidate, 1000, {}, start + 65000).candidate).toEqual(candidate);
  });
  it.each([
    { duration: 240000, observation: 60000 },
    { duration: 240000, observation: 1000 },
    { duration: 300000, observation: 60000 },
    { duration: 300000, observation: 1000 },
  ])(
    'keeps the current session when an old event is delivered again %j',
    ({ duration, observation }) => {
      const candidate = at(duration).candidate;
      const result = step(candidate, observation, {}, start + duration + 15000);
      expect(result.candidate).toEqual(candidate);
      expect(result.status).toBe(duration < 300000 ? 'candidate' : 'confirmed');
      expect(result.confirmed).toBeNull();
    },
  );
  it('still rejects a stale event newer than the last processed observation', () => {
    const candidate = at(60000).candidate;
    const result = step(candidate, 120000, {}, start + 300000);
    expect(result.candidate).toBeNull();
    expect(result.confirmed).toBeNull();
    expect(result.status).toBe('uncertain');
  });
  it('starts a new session when moving to another region', () => {
    const c = at(240000).candidate;
    const result = step(c, 300000, { regionId: 'B' });
    expect(result.confirmed).toBeNull();
    expect(result.candidate?.startedAt).toBe(start + 300000);
  });
  it('does not count a long gap after restart as time spent in a region', () => {
    const c = step(null, 0).candidate;
    expect(step(c, 300000).confirmed).toBeNull();
    expect(step(c, 300000).candidate?.startedAt).toBe(start + 300000);
  });
  it('does not award a visit when the user leaves the pack', () => {
    expect(step(at(240000).candidate, 300000, { regionId: null }).status).toBe('outside');
  });
  it.each([
    { accuracy: 90 },
    { accuracy: -1 },
    { accuracy: Infinity },
    { longitude: NaN },
    { latitude: 100 },
    { boundaryDistanceM: 5 },
  ])('resets uncertain input %j', (patch) =>
    expect(step(at(240000).candidate, 300000, patch).candidate).toBeNull(),
  );
  it('rejects stale samples', () =>
    expect(step(null, 0, {}, start + 180000).status).toBe('uncertain'));
  it('rejects future timestamps beyond tolerance', () =>
    expect(step(null, 0, { timestamp: start + 40000 }, start).status).toBe('uncertain'));
  it('allows a new visit after exit and re-entry', () => {
    const c = at(300000).candidate;
    const exited = step(c, 330000, { regionId: null });
    expect(step(exited.candidate, 360000).candidate?.confirmedAt).toBeNull();
  });
});
