import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collectionStats } from '../../src/domain/collection';
import { regions, regionPack } from '../../src/data/regions';
import { useAppStore } from '../../src/store/useAppStore';
import { colors, styles } from '../../src/ui/theme';
const ids = new Set(regions.map((r) => r.id));
export default function CollectionScreen() {
  const stats = collectionStats(
    useAppStore((s) => s.visits),
    ids,
  );
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>COLLECT YOUR WORLD</Text>
        <Text style={styles.title}>나의 수집 현황</Text>
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
            <Text style={[styles.title, { fontSize: 46, lineHeight: 56, color: colors.mint }]}>
              {stats.count}
            </Text>
            <Text style={styles.body}>/ {stats.total} 지역</Text>
          </View>
          <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4 }}>
            <View
              style={{
                height: 8,
                width: `${stats.percentage}%`,
                borderRadius: 4,
                backgroundColor: colors.mint,
              }}
            />
          </View>
          <Text style={styles.body}>
            {stats.percentage.toFixed(1)}% 색칠했어요 · {regionPack.year} 경계 팩 기준
          </Text>
        </View>
        <Text style={styles.heading}>발자국 배지</Text>
        {stats.badges.map((badge) => (
          <View key={badge.id} style={[styles.card, { opacity: badge.earned ? 1 : 0.6 }]}>
            <View style={styles.row}>
              <Text style={styles.heading}>
                {badge.earned ? '✦' : '◇'} {badge.name}
              </Text>
              <Text style={styles.chipText}>
                {badge.earned ? '획득' : `${stats.count} / ${badge.threshold}`}
              </Text>
            </View>
            <Text style={styles.body}>{badge.description}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
