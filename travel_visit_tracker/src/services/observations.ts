import * as Crypto from 'expo-crypto';
import { findRegion } from '../data/regions';
import { boundaryDistance } from '../domain/geometry';
import { advanceDwell } from '../domain/dwell';
import type { LocationSample } from '../domain/types';
import { getRepository } from '../storage/database';

export async function saveObservations(samples: LocationSample[], shouldProcess?: () => boolean) {
  const repository = await getRepository();
  for (const sample of [...samples].sort((a, b) => a.timestamp - b.timestamp)) {
    if (shouldProcess && !shouldProcess()) return;
    const region = findRegion(sample.longitude, sample.latitude);
    const observation = {
      ...sample,
      regionId: region?.id ?? null,
      boundaryDistanceM: region
        ? boundaryDistance([sample.longitude, sample.latitude], region.feature.geometry)
        : Infinity,
    };
    const receivedAt = Date.now();
    await repository.processObservation(
      (previous) => advanceDwell(previous, observation, receivedAt, Crypto.randomUUID),
      Crypto.randomUUID,
      { timestamp: sample.timestamp, accuracy: sample.accuracy, receivedAt },
      shouldProcess,
    );
  }
}
