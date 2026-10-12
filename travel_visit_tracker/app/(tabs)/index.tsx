import { useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { regions, regionById, regionPack } from '../../src/data/regions';
import { collectionStats } from '../../src/domain/collection';
import { useAppStore } from '../../src/store/useAppStore';
import { RegionMap } from '../../src/ui/RegionMap';
import { Button } from '../../src/ui/Button';
import { colors, styles } from '../../src/ui/theme';

const packIds = new Set(regions.map((r) => r.id));
export default function MapScreen() {
  const app = useAppStore();
  const [selected, select] = useState<string | null>(null),
    [searching, search] = useState(false),
    [query, setQuery] = useState('');
  const stats = useMemo(() => collectionStats(app.visits, packIds), [app.visits]);
  const region = selected ? regionById.get(selected) : undefined;
  const visit = app.visits.find((v) => v.regionId === selected);
  const candidate = app.candidate,
    current = candidate ? regionById.get(candidate.regionId) : undefined;
  const elapsed = candidate
    ? Math.min(300, Math.floor((candidate.lastObservedAt - candidate.startedAt) / 1000))
    : 0;
  const filtered = regions
    .filter((r) => `${r.name} ${r.sourceName}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 40);
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={{ padding: 20, gap: 10 }}>
        <Text style={styles.eyebrow}>TRIP PAINTING</Text>
        <View style={styles.row}>
          <Text style={styles.title}>여행으로 채우는 지도</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.body}>
            {stats.count} / {stats.total} 지역 · {stats.percentage.toFixed(1)}%
          </Text>
          <Button title="지역 찾기" secondary onPress={() => search(true)} />
        </View>
      </View>
      <View style={{ flex: 1, minHeight: 250 }}>
        <RegionMap visited={stats.visited} selected={selected} onSelect={select} />
      </View>
      <View style={{ padding: 16, gap: 8 }}>
        <Text style={[styles.body, { fontSize: 10 }]}>
          {regionPack.attribution} · {regionPack.year} 개발용 경계
        </Text>
        {region ? (
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heading}>{region.name}</Text>
                <Text style={styles.body}>{visit ? '방문한 지역' : '아직 색칠하지 않은 지역'}</Text>
              </View>
              <Button title="닫기" secondary onPress={() => select(null)} />
            </View>
            <Button
              title={visit ? '사진과 방문 기록 보기' : '지역 상세 보기'}
              onPress={() => router.push({ pathname: '/region/[id]', params: { id: region.id } })}
            />
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heading}>
                  {app.recording ? (current?.name ?? '방문 기록 중') : '다음 발자국을 남겨 보세요'}
                </Text>
                <Text style={styles.body}>{app.message || '5분 이상 머문 지역을 색칠해요'}</Text>
                {candidate && candidate.confirmedAt === null && (
                  <Text style={{ color: colors.mint }}>
                    {Math.floor(elapsed / 60)}분 {elapsed % 60}초 / 5분 확인
                  </Text>
                )}
              </View>
              <Button
                title={app.recording ? '끄기' : '기록 켜기'}
                disabled={app.busy || Platform.OS === 'web'}
                onPress={() =>
                  app.recording ? void app.tracking(false) : router.push('/(tabs)/settings')
                }
              />
            </View>
          </View>
        )}
      </View>
      <Modal visible={searching} animationType="slide" onRequestClose={() => search(false)}>
        <SafeAreaView style={styles.screen}>
          <View style={styles.content}>
            <Text style={styles.heading}>지역 찾기</Text>
            <TextInput
              accessibilityLabel="지역 이름"
              placeholder="강남구 또는 Gangnam-gu"
              placeholderTextColor={colors.muted}
              value={query}
              onChangeText={setQuery}
              style={[styles.text, styles.card]}
            />
            <Button title="닫기" secondary onPress={() => search(false)} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {filtered.map((r) => (
              <Button
                key={r.id}
                title={`${stats.visited.has(r.id) ? '✓ ' : ''}${r.name}`}
                secondary
                onPress={() => {
                  select(r.id);
                  search(false);
                }}
              />
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
