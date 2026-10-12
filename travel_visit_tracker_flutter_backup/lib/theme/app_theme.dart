import 'package:flutter/material.dart';

class AppTheme {
  // Map Colors (Hex strings for MapLibre)
  static const String mapFillColor = '#4CAF50';
  static const String mapBorderColor = '#2E7D32';
  
  // Opacity
  static const double mapFillOpacity = 0.2;
  static const double mapBorderOpacity = 0.8;
  static const double mapBorderWidth = 2.0;

  static ThemeData get lightTheme {
    return ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: Colors.green),
      useMaterial3: true,
      scaffoldBackgroundColor: Colors.white,
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.white,
        elevation: 0,
        centerTitle: true,
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 4,
      ),
    );
  }
}
