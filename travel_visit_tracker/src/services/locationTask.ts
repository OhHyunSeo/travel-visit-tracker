import * as TaskManager from 'expo-task-manager';
import type { LocationObject } from 'expo-location';
import { getRepository } from '../storage/database';
import { saveObservations } from './observations';

export const LOCATION_TASK = 'trip-painting-location-v1';
TaskManager.defineTask<{ locations: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  const repository = await getRepository();
  if (error) {
    await repository.interruptCandidate('위치 수집이 중단되었습니다. 설정과 권한을 확인해 주세요.');
    return;
  }
  if (!data?.locations?.length) return;
  await saveObservations(
    data.locations.map((location) => ({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy ?? Infinity,
      timestamp: location.timestamp,
    })),
  );
});
