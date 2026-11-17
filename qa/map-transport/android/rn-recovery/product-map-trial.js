import React, { useEffect, useState } from 'react';
import { NativeModules, Pressable, StyleSheet, Text, View } from 'react-native';
import { regions } from './product-source/data/regions';
import { getSavedBackgroundMap } from './product-source/services/savedBackgroundMap.native';
import { RegionMap } from './product-source/ui/RegionMap.native';

const emptyVisits = new Set();
const ignoreSelection = () => {};
const selected = regions[0].id;

export function ProductMapTrial({ packId }) {
  const [saved, setSaved] = useState(null);
  const [phase, setPhase] = useState('saved');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void getSavedBackgroundMap().then((background) => {
      if (!background || background.packId !== packId || background.regionId !== selected)
        throw new Error('Product map rejected the recovered saved style');
      if (active) setSaved(background);
    }).catch((failure) => { if (active) setError(String(failure)); });
    return () => { active = false; };
  }, [packId]);

  useEffect(() => {
    if (saved) NativeModules.TPRecoveryReport.publishMapPhase(phase);
  }, [saved, phase]);

  if (error) return <Text style={styles.label}>{error}</Text>;
  if (!saved) return <Text style={styles.label}>저장 지도 확인 중</Text>;

  const enabled = phase !== 'disabled';
  return (
    <View style={styles.screen}>
      <Pressable
        accessibilityLabel="Fixture saved background map"
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled }}
        onPress={() => setPhase(enabled ? 'disabled' : 'restored')}
        style={styles.header}
      >
        <Text style={styles.label}>{enabled ? '저장 배경지도 끄기' : '저장 배경지도 켜기'}</Text>
      </Pressable>
      <RegionMap
        visited={emptyVisits}
        selected={selected}
        onSelect={ignoreSelection}
        background={enabled ? saved : undefined}
        onBackgroundError={() => setError('제품 지도에서 저장 스타일을 열지 못했습니다.')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 36, backgroundColor: '#142526' },
  header: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16 },
  label: { color: '#f0f7f5' },
});
