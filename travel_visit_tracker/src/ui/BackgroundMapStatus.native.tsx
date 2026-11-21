import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';
import { recoverInstalledBackgroundMapOperation } from '../services/backgroundMapRecovery.native';
import { Button } from './Button';
import { styles } from './theme';

type MapStatus =
  | Awaited<ReturnType<typeof recoverInstalledBackgroundMapOperation>>
  | { kind: 'checking' }
  | { kind: 'error' };

export function backgroundMapStatusMessage(status: MapStatus): string {
  switch (status.kind) {
    case 'checking':
      return '이 기기에 저장된 지도를 확인하고 있습니다.';
    case 'idle':
      return '이 기기에 저장한 배경 지도가 없습니다.';
    case 'awaiting-pack':
      return '지도 저장 준비가 끝났습니다. 아직 저장된 지도는 없습니다.';
    case 'missing-pack':
      return '저장 기록은 있지만 이 기기에서 해당 지도를 찾을 수 없습니다.';
    case 'conflict':
      return '저장 기록과 지도 정보가 일치하지 않습니다.';
    case 'incomplete':
      return status.downloading
        ? '배경 지도를 저장하고 있습니다.'
        : '배경 지도 저장이 아직 완료되지 않았습니다.';
    case 'complete':
      return '배경 지도 저장이 완료됐습니다.';
    case 'error':
      return '저장 상태를 확인할 수 없습니다. 다시 확인해 주세요.';
  }
}

const checkTimeoutMs = 10_000;

export function checkBackgroundMapStatus(update: (status: MapStatus) => void) {
  let accepting = true;
  const stop = () => {
    accepting = false;
    clearTimeout(timeout);
  };
  const finish = (status: MapStatus) => {
    if (!accepting) return;
    stop();
    update(status);
  };
  const timeout = setTimeout(() => finish({ kind: 'error' }), checkTimeoutMs);
  update({ kind: 'checking' });
  void recoverInstalledBackgroundMapOperation().then(finish, () => finish({ kind: 'error' }));
  return stop;
}

export function BackgroundMapStatus() {
  const [status, setStatus] = useState<MapStatus>({ kind: 'checking' });
  const stopCheck = useRef<(() => void) | null>(null);
  const refresh = useCallback(() => {
    stopCheck.current?.();
    stopCheck.current = checkBackgroundMapStatus(setStatus);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      return () => {
        stopCheck.current?.();
        stopCheck.current = null;
      };
    }, [refresh]),
  );

  return (
    <View style={styles.card}>
      <Text style={styles.heading} accessibilityRole="header">
        오프라인 배경 지도
      </Text>
      <Text
        style={status.kind === 'error' ? styles.error : styles.body}
        accessibilityLiveRegion="polite"
      >
        {backgroundMapStatusMessage(status)}
      </Text>
      <Button
        title="저장 상태 다시 확인"
        secondary
        disabled={status.kind === 'checking'}
        onPress={refresh}
      />
    </View>
  );
}
