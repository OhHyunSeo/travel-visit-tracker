import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from '../../src/store/useAppStore';
import { regionPack } from '../../src/data/regions';
import { dwellPolicy } from '../../src/domain/dwell';
import type { TrackingDiagnostics } from '../../src/domain/types';
import { Button } from '../../src/ui/Button';
import { styles } from '../../src/ui/theme';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/store/useAuthStore';

const modeLabels: Record<TrackingDiagnostics['collectorMode'], string> = {
  off: '수집 중단 / 대기',
  foreground: '앱을 화면에 연 동안',
  background: '화면 잠금 중에도',
};
const formatTime = (at: number | null) =>
  at === null ? '아직 없음' : new Date(at).toLocaleString('ko-KR');
const formatSeconds = (milliseconds: number | null) =>
  milliseconds === null ? '아직 없음' : `${(milliseconds / 1000).toFixed(1)}초`;

export default function SettingsScreen() {
  const app = useAppStore();
  const auth = useAuthStore();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 4_000);
    return () => clearInterval(timer);
  }, []);
  const diagnostics = app.diagnostics;
  const latestGpsVisit = app.visits.find((visit) => visit.source === 'gps');
  const sampleAge = diagnostics.lastSampleAt === null ? null : now - diagnostics.lastSampleAt;
  const reception = !app.recording
    ? '자동 기록이 꺼져 있습니다.'
    : diagnostics.collectorMode === 'off'
      ? '위치 수집이 일시 중단되어 있습니다.'
      : sampleAge === null
        ? '첫 위치를 기다리고 있습니다.'
        : sampleAge < -dwellPolicy.futureToleranceMs
          ? '위치 시각이 맞지 않아 휴대폰 시각을 확인해야 합니다.'
          : sampleAge > dwellPolicy.maxGapMs
            ? '2분 이상 새 위치가 들어오지 않았습니다.'
            : diagnostics.accuracyM === null
              ? '위치 정확도를 확인할 수 없습니다.'
              : diagnostics.accuracyM > dwellPolicy.maxAccuracyM
                ? '위치 오차가 커서 체류 확인을 기다립니다.'
                : '위치를 받고 있습니다.';
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>YOUR JOURNEY, YOUR CONTROL</Text>
        <Text style={styles.title}>기록 설정</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>내 기록 계정</Text>
          <Text style={styles.body}>
            {auth.session
              ? `${auth.session.user.username} 계정의 기록을 보고 있습니다.`
              : '로그인 없이 이 기기에 기록하고 있습니다.'}
          </Text>
          <Text style={styles.body}>
            계정 로그인과 게스트 기록 가져오기를 설정할 수 있습니다. 서버 백업은 아직 연결 전입니다.
          </Text>
          <Button
            title="로그인과 계정 설정"
            secondary
            disabled={app.busy}
            onPress={() => router.push('/account')}
          />
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>자동 방문 기록</Text>
          <Text style={styles.body}>
            한 지역에서 신뢰할 수 있는 위치가 5분 이상 이어지면 방문을 기록합니다. 위치가 끊기거나
            불확실하면 체류 확인을 다시 시작합니다.
          </Text>
          <Text style={styles.body}>{app.message}</Text>
          {Platform.OS === 'web' ? (
            <Text style={styles.body}>
              브라우저에서는 지도와 기록 화면을 미리 볼 수 있습니다. 자동 방문과 사진은 휴대폰
              앱에서 확인해 주세요.
            </Text>
          ) : (
            <>
              {app.recording ? (
                <Button
                  title="자동 기록 끄기"
                  disabled={app.busy}
                  onPress={() => {
                    void app.tracking(false);
                  }}
                />
              ) : (
                <>
                  <Button
                    title="화면을 켠 동안 기록"
                    disabled={app.busy}
                    onPress={() => {
                      void app.tracking(true, false);
                    }}
                  />
                  <Text style={styles.body}>
                    화면 잠금 기록을 켜면 항상 위치 허용을 요청합니다. Android에서는 알림을 허용하면
                    기록 알림이 표시됩니다. 앱을 강제 종료하면 수집이 중단될 수 있습니다.
                  </Text>
                  <Button
                    title="화면 잠금 중에도 기록"
                    secondary
                    disabled={app.busy}
                    onPress={() => {
                      void app.tracking(true, true);
                    }}
                  />
                </>
              )}
              <Button
                title="휴대폰 권한 설정 열기"
                secondary
                onPress={() => {
                  void Linking.openSettings();
                }}
              />
            </>
          )}
        </View>
        {Platform.OS === 'android' && (
          <View style={styles.card}>
            <Text style={styles.heading}>잠금 중 기록과 배터리 설정</Text>
            <Text style={styles.body}>
              절전 모드나 앱 배터리 제한 때문에 위치가 늦게 들어올 수 있습니다. 2분 넘게 위치가
              끊기면 체류 확인을 다시 시작하며, 이미 저장한 방문과 사진은 남아 있습니다.
            </Text>
            <Text style={styles.body}>
              잠금 중 기록이 멈춘다면 휴대폰 설정에서 이 앱의 위치 권한과 배터리 제한을 확인해
              주세요.
            </Text>
            <Button
              title="휴대폰 앱 설정 열기"
              secondary
              onPress={() => {
                void Linking.openSettings();
              }}
            />
          </View>
        )}
        <View style={styles.card}>
          <Text style={styles.heading}>지금 기록 상태</Text>
          <Text style={styles.body}>{reception}</Text>
          <Text style={styles.body}>선택한 방식: {modeLabels[app.recordingMode]}</Text>
          <Text style={styles.body}>현재 동작: {modeLabels[diagnostics.collectorMode]}</Text>
          {app.recording &&
            app.recordingMode === 'background' &&
            diagnostics.collectorMode === 'foreground' && (
              <Text style={styles.body}>
                현재는 앱을 화면에 연 동안만 수집합니다. 화면 잠금 중에도 기록하려면 위치 권한을
                확인해 주세요.
              </Text>
            )}
          <Text style={styles.body}>마지막 위치 시각: {formatTime(diagnostics.lastSampleAt)}</Text>
          <Text style={styles.body}>
            위치 오차:{' '}
            {diagnostics.accuracyM === null
              ? '확인할 수 없음'
              : `약 ${Math.round(diagnostics.accuracyM)}m`}
            {' · '}
            {dwellPolicy.maxAccuracyM}m 이하에서 체류를 확인합니다
          </Text>
          <Text style={styles.body}>
            관측 간격: {formatSeconds(diagnostics.gapMs)} · 수신 지연:{' '}
            {formatSeconds(diagnostics.delayMs)}
          </Text>
          <Text style={styles.body}>
            마지막 체류 재시작:{' '}
            {diagnostics.lastResetReason
              ? `${formatTime(diagnostics.lastResetAt)}\n${diagnostics.lastResetReason}`
              : '아직 없음'}
          </Text>
          <Text style={styles.body}>
            마지막 GPS 방문 저장: {formatTime(latestGpsVisit?.confirmedAt ?? null)}
          </Text>
          <Text style={styles.body}>
            체류 확인을 다시 시작해도 이미 저장한 방문은 남아 있습니다. 이 안내에는 위치 좌표를
            기록하지 않습니다.
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>기기에 안전하게 저장</Text>
          <Text style={styles.body}>
            방문과 사진은 기기에 저장합니다. 지금 버전은 서버 백업 연결 전이며 앱 삭제 시 복원할 수
            없습니다.
          </Text>
          <Text style={styles.body}>
            서버 전송 대기 작업: {app.pending}개 · 아직 자동 전송되지 않습니다
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>지도 자료</Text>
          <Text style={styles.body}>
            {regionPack.attribution}
            {'\n'}
            {regionPack.year}년 기준 개발용 팩 · 실제 도형 {regionPack.count}개{'\n'}최신 행정구역
            개편을 반영한 출시용 데이터는 준비 중입니다. 배경 도로 지도는 아직 제공하지 않습니다.
          </Text>
          <Button
            title="데이터 출처"
            secondary
            onPress={() => {
              void Linking.openURL('https://www.geoboundaries.org/');
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
