import * as Location from 'expo-location';
import { PermissionsAndroid, Platform, type AppStateStatus } from 'react-native';
import { getRepository } from '../storage/database';
import { LOCATION_TASK } from './locationTask';
import { saveObservations } from './observations';

let foregroundSubscription: Location.LocationSubscription | null = null;
let foregroundGeneration = 0;
let mode: 'off' | 'foreground' | 'background' = 'off';
let transitioning: Promise<unknown> = Promise.resolve();
const options: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.High,
  timeInterval: 15_000,
  distanceInterval: 0,
  pausesUpdatesAutomatically: false,
  activityType: Location.ActivityType.Other,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: '여행 색칠 기록 중',
    notificationBody: '5분 이상 머문 지역을 지도에 기록합니다.',
    killServiceOnDestroy: true,
  },
};

function exclusive<T>(action: () => Promise<T>): Promise<T> {
  const next = transitioning.then(action);
  transitioning = next.catch(() => undefined);
  return next;
}
async function stopCollectors() {
  foregroundGeneration++;
  foregroundSubscription?.remove();
  foregroundSubscription = null;
  if (Platform.OS !== 'web' && (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)))
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  mode = 'off';
  await (await getRepository()).setCollectorMode('off');
}
async function attachCollector(background: boolean) {
  if (background) {
    foregroundGeneration++;
    foregroundSubscription?.remove();
    foregroundSubscription = null;
    if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)))
      await Location.startLocationUpdatesAsync(LOCATION_TASK, options);
    mode = 'background';
  } else {
    const generation = foregroundSubscription ? foregroundGeneration : ++foregroundGeneration;
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    if (foregroundSubscription) return;
    const isCurrentCollector = () => generation === foregroundGeneration;
    foregroundSubscription = await Location.watchPositionAsync(options, (location) => {
      if (!isCurrentCollector()) return;
      void saveObservations(
        [
          {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy ?? Infinity,
            timestamp: location.timestamp,
          },
        ],
        isCurrentCollector,
      )
        .catch(async () => {
          if (!isCurrentCollector()) return;
          await (
            await getRepository()
          ).interruptCandidate(
            '위치 저장에 실패했습니다. 앱을 다시 열어 확인해 주세요.',
            Date.now(),
            isCurrentCollector,
          );
        })
        .catch(() => undefined);
    });
    mode = 'foreground';
  }
  await (await getRepository()).setCollectorMode(mode);
}
export function startTracking(background: boolean) {
  return exclusive(async () => {
    if (Platform.OS === 'web')
      throw new Error('자동 방문 기록은 iPhone 또는 Android 개발 빌드에서 사용할 수 있습니다.');
    if (!(await Location.hasServicesEnabledAsync()))
      throw new Error('휴대폰의 위치 서비스를 켜 주세요.');
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== 'granted')
      throw new Error('방문 기록을 켜려면 위치 접근을 허용해 주세요.');
    if (background) {
      const permission = await Location.requestBackgroundPermissionsAsync();
      if (permission.status !== 'granted')
        throw new Error(
          '화면 잠금 기록에는 항상 허용 권한이 필요합니다. 설정에서 변경하거나 화면을 켠 동안 기록을 사용해 주세요.',
        );
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        const notification = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
        if (!(await PermissionsAndroid.check(notification)))
          await PermissionsAndroid.request(notification);
        // Denial hides the drawer notification; it must not disable location recording.
      }
    }
    const repository = await getRepository();
    await stopCollectors();
    await repository.setRecording(true, background ? 'background' : 'foreground');
    try {
      await attachCollector(background);
    } catch (error) {
      await stopCollectors();
      await repository.setRecording(false);
      throw error;
    }
    await repository.setStatus(
      'waiting',
      background
        ? '화면 잠금 기록이 켜졌습니다. 위치를 기다립니다.'
        : '앱을 화면에 연 동안 기록합니다.',
    );
  });
}
export function stopTracking() {
  return exclusive(async () => {
    await stopCollectors();
    await (await getRepository()).setRecording(false);
  });
}
export function reconcileTracking() {
  return exclusive(async () => {
    if (Platform.OS === 'web') return;
    const repository = await getRepository(),
      snapshot = await repository.snapshot(__DEV__);
    if (!snapshot.recording) {
      await stopCollectors();
      return;
    }
    await repository.expireCandidate();
    const foreground = await Location.getForegroundPermissionsAsync();
    if (foreground.status !== 'granted' || !(await Location.hasServicesEnabledAsync())) {
      await stopCollectors();
      await repository.setRecording(false);
      await repository.setStatus(
        'uncertain',
        '위치 기록이 멈췄습니다. 위치 서비스와 권한을 확인해 주세요.',
      );
      return;
    }
    const background = await Location.getBackgroundPermissionsAsync();
    if (
      snapshot.recordingMode === 'background' &&
      background.status !== 'granted' &&
      snapshot.diagnostics.collectorMode === 'background'
    ) {
      await stopCollectors();
      await repository.interruptCandidate(
        '화면 잠금 위치 권한이 변경되어 체류 확인을 다시 시작합니다.',
      );
    }
    await attachCollector(
      snapshot.recordingMode === 'background' && background.status === 'granted',
    );
    if (mode === 'foreground' && !(await repository.snapshot(__DEV__)).candidate)
      await repository.setStatus('waiting', '앱을 화면에 연 동안 기록합니다.');
  });
}
export function checkTrackingHealth() {
  return exclusive(async () => {
    if (Platform.OS === 'web') return;
    const repository = await getRepository();
    const snapshot = await repository.snapshot(__DEV__);
    if (!snapshot.recording) return;

    const foreground = await Location.getForegroundPermissionsAsync();
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (foreground.status !== 'granted' || !servicesEnabled) {
      await stopCollectors();
      await repository.setRecording(false);
      await repository.setStatus(
        'uncertain',
        !servicesEnabled
          ? '위치 서비스가 꺼져 기록을 중단했습니다. 위치를 켠 뒤 기록을 다시 시작해 주세요.'
          : '위치 권한이 없어 기록을 중단했습니다. 권한을 허용한 뒤 기록을 다시 시작해 주세요.',
      );
      return;
    }
    if (snapshot.recordingMode === 'background' && mode === 'background') {
      const background = await Location.getBackgroundPermissionsAsync();
      if (background.status !== 'granted') {
        await stopCollectors();
        await repository.interruptCandidate(
          '화면 잠금 위치 권한이 변경되어 체류 확인을 다시 시작합니다.',
        );
        await attachCollector(false);
        await repository.setStatus(
          'waiting',
          '화면 잠금 권한이 없어 앱을 화면에 연 동안만 기록합니다.',
        );
      }
    }
    await repository.expireCandidate();
  });
}
export function onAppBackground() {
  // Invalidate queued callbacks immediately, including a watcher still starting.
  foregroundGeneration++;
  return exclusive(async () => {
    if (mode === 'foreground') {
      foregroundSubscription?.remove();
      foregroundSubscription = null;
      mode = 'off';
      const repository = await getRepository();
      await repository.setCollectorMode('off');
      await repository.interruptCandidate('앱이 화면 밖으로 나가 위치 기록이 일시 중단됐습니다.');
    }
  });
}

export function onAppStateChange(state: AppStateStatus): Promise<void> {
  if (state === 'active') return reconcileTracking();
  if (state === 'background') return onAppBackground();
  // iOS inactive includes brief overlays; continuity still requires fresh samples.
  return Promise.resolve();
}
