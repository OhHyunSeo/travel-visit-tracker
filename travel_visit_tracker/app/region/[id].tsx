import { Alert, Image, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { regionById } from '../../src/data/regions';
import { groupRegionHistory } from '../../src/domain/regionHistory';
import { useAppStore } from '../../src/store/useAppStore';
import { Button } from '../../src/ui/Button';
import { colors, styles } from '../../src/ui/theme';
export default function RegionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useAppStore(),
    region = regionById.get(id),
    history = groupRegionHistory(app.visits, app.photos).find((group) => group.regionId === id);
  const visits = history?.visits ?? [];
  const photos = history?.photos ?? [];
  const confirmDelete = (visitId: string) => {
    if (Platform.OS === 'web') {
      if (window.confirm('이 방문 기록과 연결된 사진을 삭제할까요?')) void app.deleteVisit(visitId);
    } else
      Alert.alert('방문 삭제', '이 방문 기록과 연결된 사진을 삭제할까요?', [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            void app.deleteVisit(visitId);
          },
        },
      ]);
  };
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Button
          title="지도로 돌아가기"
          secondary
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
        <Text style={styles.eyebrow}>A PIECE OF YOUR JOURNEY</Text>
        <Text style={styles.title}>{region?.name ?? '지역을 찾을 수 없습니다'}</Text>
        <Text style={styles.body}>
          {visits.length
            ? '수집한 지역 1개 · 재방문도 이 지역에 모아 두었어요'
            : '아직 방문 기록이 없어요'}
        </Text>
        {region && visits.length === 0 && (
          <View style={styles.card}>
            <Text style={styles.body}>
              자동 기록을 켜고 이 지역에 5분 이상 머무르면 지도가 색칠됩니다.
            </Text>
          </View>
        )}
        {visits.length > 0 && (
          <Button
            title="이 지역에 사진 붙이기"
            disabled={app.busy || Platform.OS === 'web'}
            onPress={() => {
              void app.addPhoto(visits[0].id);
            }}
          />
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {photos.map((photo) => (
            <Image
              key={photo.id}
              source={{ uri: photo.uri }}
              style={{ width: 150, height: 150, borderRadius: 16 }}
              accessibilityLabel="이 지역의 추억 사진"
            />
          ))}
        </View>
        {visits.length > 0 && <Text style={styles.heading}>방문 내역 {visits.length}건</Text>}
        {visits.map((visit) => (
          <View key={visit.id} style={styles.card}>
            <Text style={styles.heading}>
              {new Date(visit.confirmedAt).toLocaleString('ko-KR')}
            </Text>
            <Text style={styles.body}>
              {visit.source === 'gps' ? '5분 체류 확인' : '개발용 방문 입력'}
            </Text>
            <Button
              title="이 방문 삭제"
              secondary
              disabled={app.busy}
              onPress={() => confirmDelete(visit.id)}
            />
          </View>
        ))}
        {__DEV__ && region && (
          <View style={[styles.card, { borderColor: colors.amber }]}>
            <Text style={{ color: colors.amber }}>개발 빌드 전용</Text>
            <Text style={styles.body}>
              지도 색칠과 저장을 검증하는 입력입니다. 실제 GPS 방문이나 서버 전송으로 취급하지
              않습니다.
            </Text>
            <Button
              title="개발용 방문 추가"
              secondary
              disabled={app.busy}
              onPress={() => {
                void app.developmentVisit(region.id);
              }}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
