import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../src/ui/theme';
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.mint,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '내 지도',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>◈</Text>,
        }}
      />
      <Tabs.Screen
        name="records"
        options={{
          title: '기록',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>▤</Text>,
        }}
      />
      <Tabs.Screen
        name="collection"
        options={{
          title: '수집 현황',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>✦</Text>,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '설정',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⚙</Text>,
        }}
      />
    </Tabs>
  );
}
