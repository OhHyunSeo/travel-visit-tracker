import { useEffect } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from '../src/store/useAppStore';
import { checkTrackingHealth, onAppStateChange } from '../src/services/tracking';
import { colors, styles } from '../src/ui/theme';
import { Button } from '../src/ui/Button';

export default function RootLayout() {
  const ready = useAppStore((s) => s.ready),
    error = useAppStore((s) => s.error);
  useEffect(() => {
    void useAppStore.getState().initialize();
    const subscription = AppState.addEventListener('change', (state) => {
      const operation = onAppStateChange(state).then(() => useAppStore.getState().refresh());
      void operation.catch(() =>
        useAppStore.setState({ error: '위치 상태를 확인하지 못했습니다. 설정을 확인해 주세요.' }),
      );
    });
    let checking = false;
    const timer = setInterval(() => {
      if (checking) return;
      if (AppState.currentState === 'active' && useAppStore.getState().ready) {
        checking = true;
        void checkTrackingHealth()
          .then(() => useAppStore.getState().refresh())
          .catch(() =>
            useAppStore.setState({
              error: '위치 상태를 확인하지 못했습니다. 설정을 확인해 주세요.',
            }),
          )
          .finally(() => {
            checking = false;
          });
      }
    }, 4000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {!ready ? (
        <SafeAreaView style={[styles.screen, styles.content, { justifyContent: 'center' }]}>
          {error ? (
            <>
              <Text style={styles.heading}>기록을 열 수 없습니다</Text>
              <Text style={styles.error}>{error}</Text>
              <Button
                title="다시 시도"
                onPress={() => {
                  void useAppStore.getState().initialize();
                }}
              />
            </>
          ) : (
            <>
              <ActivityIndicator color={colors.mint} />
              <Text style={[styles.body, { textAlign: 'center' }]}>내 지도를 불러오는 중</Text>
            </>
          )}
        </SafeAreaView>
      ) : (
        <>
          {error && (
            <SafeAreaView edges={['top']} style={{ backgroundColor: colors.surface, padding: 12 }}>
              <View style={{ gap: 8 }}>
                <Text style={styles.error}>{error}</Text>
                <Button
                  title="확인"
                  secondary
                  onPress={() => useAppStore.getState().clearError()}
                />
              </View>
            </SafeAreaView>
          )}
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="(tabs)" />
          </Stack>
        </>
      )}
    </SafeAreaProvider>
  );
}
