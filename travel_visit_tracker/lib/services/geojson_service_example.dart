// Example usage of GeoJSONService
// This file demonstrates how to use the GeoJSON service in your app

import 'geojson_service.dart';

Future<void> exampleUsage() async {
  final geoJsonService = GeoJSONService();

  // Example 1: Load GeoJSON pack with automatic fallback
  try {
    final geoJsonString = await geoJsonService.loadPack('KR');
    print('Loaded GeoJSON for Korea');

    // Parse features into Region models
    final regions = geoJsonService.parseFeatures(geoJsonString, 'KR');
    print('Parsed ${regions.length} regions');

    // Access region properties
    for (final region in regions) {
      print('Region: ${region.name}');
      print('  Category: ${region.displayCategory}');
      print(
          '  Centroid: ${region.centroid.latitude}, ${region.centroid.longitude}');
    }
  } catch (e) {
    print('Error loading GeoJSON: $e');
  }

  // Example 2: Check if cache exists before loading
  final hasCached = await geoJsonService.hasCachedPack('US');
  if (hasCached) {
    final cachedData = await geoJsonService.getCachedPack('US');
    print('Loaded from cache');
  }

  // Example 3: Apply admin level rules
  final category = geoJsonService.applyAdminLevelRules('KR', 8);
  print('Admin level 8 in Korea is: $category'); // Output: District

  // Example 4: Clear cache when needed
  await geoJsonService.clearCache('KR');
  print('Cache cleared for Korea');
}
