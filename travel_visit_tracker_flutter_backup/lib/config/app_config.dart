class AppConfig {
  // Backend API URL
  // Use http://localhost:3000 for iOS Simulator
  // Use http://10.0.2.2:3000 for Android Emulator
  static const String apiBaseUrl = 'http://localhost:3000/api';
  
  // Map Style URL (CartoDB Positron)
  static const String mapStyleUrl = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

  // Map Constants
  static const double selectZoomLevel = 14.0;
  static const double initialZoomLevel = 10.0;
  static const double initialLat = 37.5665;
  static const double initialLng = 126.9780;
}
