import { useMemo } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { regionById } from '../../src/data/regions';
import { groupRegionHistory } from '../../src/domain/regionHistory';
import { useAppStore } from '../../src/store/useAppStore';
import { Button } from '../../src/ui/Button';
import { styles } from '../../src/ui/theme';
export default function RecordsScreen() {
  const { visits, photos } = useAppStore();
  const history = useMemo(() => groupRegionHistory(visits, photos), [visits, photos]);
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>YOUR FOOTPRINTS</Text>
        <Text style={styles.title}>여행의 기록</Text>
        <Text style={styles.body}>
          방문한 지역은 한 번만 표시해요. 재방문 내역과 사진은 지역별로 모아 두었어요.
        </Text>
        {!history.length && (
          <View style={styles.card}>
            <Text style={styles.heading}>첫 여행을 기다리고 있어요</Text>
            <Text style={styles.body}>지도에서 기록을 켜고 한 지역에 5분 이상 머물러 보세요.</Text>
          </View>
        )}
        {history.map((group) => {
          const photo = group.photos[0];
          return (
            <View key={group.regionId} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.heading}>
                  {regionById.get(group.regionId)?.name ?? '기록한 지역'}
                </Text>
                {group.visits.every((visit) => visit.source === 'development') && (
                  <Text style={styles.chipText}>개발 기록</Text>
                )}
              </View>
              <Text style={styles.body}>
                첫 방문: {new Date(group.firstVisitedAt).toLocaleString('ko-KR')}
              </Text>
              {group.visits.length > 1 && (
                <Text style={styles.body}>
                  최근 방문: {new Date(group.lastVisitedAt).toLocaleString('ko-KR')}
                </Text>
              )}
              {photo && (
                <Image
                  source={{ uri: photo.uri }}
                  style={{ height: 160, borderRadius: 12 }}
                  accessibilityLabel="이 지역의 방문 사진"
                />
              )}
              <Button
                title="사진과 방문 내역 보기"
                secondary
                onPress={() =>
                  router.push({ pathname: '/region/[id]', params: { id: group.regionId } })
                }
              />
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
