import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Trip Painting',
  slug: 'trip-painting',
  version: '0.1.0',
  scheme: 'trippainting',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  icon: './assets/icon.png',
  ios: {
    appleTeamId: process.env.APPLE_TEAM_ID,
    bundleIdentifier: 'app.trippainting.mobile',
    supportsTablet: false,
    infoPlist: { CFBundleDisplayName: '여행 색칠' },
  },
  android: {
    package: 'app.trippainting.mobile',
    // TaskManager persists location jobs; Android rejects those jobs without this permission.
    permissions: [
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.POST_NOTIFICATIONS',
    ],
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0b191a' },
  },
  web: { bundler: 'metro', favicon: './assets/favicon.png' },
  plugins: [
    './plugins/with-gradle-jdk.js',
    'expo-router',
    'expo-dev-client',
    ['expo-secure-store', { configureAndroidBackup: true, faceIDPermission: false }],
    '@maplibre/maplibre-react-native',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          '머문 지역을 확인하고 방문 지도를 색칠하기 위해 위치를 사용합니다.',
        locationAlwaysAndWhenInUsePermission:
          '화면을 잠근 동안에도 5분 이상 머문 지역을 기록하기 위해 위치를 사용합니다.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: '방문한 지역에 추억 사진을 붙이기 위해 사진을 선택합니다.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    [
      'expo-build-properties',
      {
        ios: { enableSceneSupport: true },
        android: { compileSdkVersion: 36, targetSdkVersion: 36 },
      },
    ],
  ],
};
export default config;
