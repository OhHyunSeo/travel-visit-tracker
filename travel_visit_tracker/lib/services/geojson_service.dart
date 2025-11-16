import 'dart:convert';
import 'dart:io';
import 'dart:async';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import '../models/region.dart';
import '../utils/geometry_simplifier.dart';

/// Custom exceptions for GeoJSON operations
class GeoJSONException implements Exception {
  final String message;
  GeoJSONException(this.message);

  @override
  String toString() => 'GeoJSONException: $message';
}

class GeoJSONNotFoundException extends GeoJSONException {
  GeoJSONNotFoundException(super.message);
}

class GeoJSONNetworkException extends GeoJSONException {
  GeoJSONNetworkException(super.message);
}

class GeoJSONParseException extends GeoJSONException {
  GeoJSONParseException(super.message);
}

class GeoJSONLoadException extends GeoJSONException {
  GeoJSONLoadException(super.message);
}

class GeoJSONService {
  // Backend base URL - update with actual backend URL
  static const String _baseUrl = 'http://localhost:3000/api';

  // Admin level mapping rules
  static const Map<String, Map<int, String>> adminLevelRules = {
    'KR': {
      8: 'District',
      7: 'City',
      4: 'Province',
    },
    'US': {
      6: 'County',
      4: 'State',
    },
    'JP': {
      7: 'City',
      4: 'Prefecture',
    },
  };

  // Cache directory for GeoJSON files
  Future<Directory> _getCacheDirectory() async {
    final appDocDir = await getApplicationDocumentsDirectory();
    final cacheDir = Directory('${appDocDir.path}/geojson_cache');
    if (!await cacheDir.exists()) {
      await cacheDir.create(recursive: true);
    }
    return cacheDir;
  }

  // Get cache file path for a country code
  Future<File> _getCacheFile(String countryCode) async {
    final cacheDir = await _getCacheDirectory();
    return File('${cacheDir.path}/${countryCode}_boundaries.geojson');
  }

  // Get ETag cache file path
  Future<File> _getETagFile(String countryCode) async {
    final cacheDir = await _getCacheDirectory();
    return File('${cacheDir.path}/${countryCode}_etag.txt');
  }

  /// Fetch GeoJSON pack from backend via HTTP
  /// Returns the GeoJSON string and caches it locally
  /// Throws exceptions on network or parse errors
  Future<String> fetchPack(String countryCode,
      {int timeoutSeconds = 30}) async {
    try {
      final url = Uri.parse('$_baseUrl/geojson/$countryCode');

      // Check for cached ETag
      final etagFile = await _getETagFile(countryCode);
      String? cachedETag;
      if (await etagFile.exists()) {
        cachedETag = await etagFile.readAsString();
      }

      // Make HTTP request with conditional headers and timeout
      final headers = <String, String>{};
      if (cachedETag != null) {
        headers['If-None-Match'] = cachedETag;
      }

      final response = await http
          .get(url, headers: headers)
          .timeout(Duration(seconds: timeoutSeconds));

      if (response.statusCode == 304) {
        // Not modified, use cached version
        return await getCachedPack(countryCode);
      }

      if (response.statusCode == 200) {
        final geoJsonString = response.body;

        // Validate JSON structure
        final decoded = json.decode(geoJsonString);
        if (decoded is! Map || decoded['type'] != 'FeatureCollection') {
          throw const FormatException(
              'Invalid GeoJSON format: missing FeatureCollection type');
        }

        // Cache the response
        final cacheFile = await _getCacheFile(countryCode);
        await cacheFile.writeAsString(geoJsonString);

        // Cache ETag if present
        final etag = response.headers['etag'];
        if (etag != null) {
          await etagFile.writeAsString(etag);
        }

        return geoJsonString;
      } else if (response.statusCode == 404) {
        throw GeoJSONNotFoundException(
            'GeoJSON pack not found for country: $countryCode');
      } else {
        throw GeoJSONLoadException(
            'Failed to fetch GeoJSON: ${response.statusCode} ${response.reasonPhrase}');
      }
    } on TimeoutException {
      throw GeoJSONLoadException(
          'Request timed out after $timeoutSeconds seconds');
    } on SocketException catch (e) {
      // Network error - throw specific exception
      throw GeoJSONNetworkException('Network error: ${e.message}');
    } on FormatException catch (e) {
      throw GeoJSONParseException('Parse error: ${e.message}');
    } catch (e) {
      throw GeoJSONLoadException('Unexpected error fetching GeoJSON: $e');
    }
  }

  /// Load GeoJSON pack from local cache
  /// Returns the cached GeoJSON string
  /// Throws exception if cache doesn't exist
  Future<String> getCachedPack(String countryCode) async {
    try {
      final cacheFile = await _getCacheFile(countryCode);

      if (!await cacheFile.exists()) {
        throw Exception('No cached GeoJSON found for country: $countryCode');
      }

      return await cacheFile.readAsString();
    } catch (e) {
      throw Exception('Error reading cached GeoJSON: $e');
    }
  }

  /// Parse GeoJSON string and convert to Region models
  /// Returns list of Region objects
  /// Throws exception on parse errors
  /// Optionally simplifies geometries to reduce coordinate count
  List<Region> parseFeatures(
    String geoJsonString,
    String countryCode, {
    bool simplifyGeometry = true,
    double simplificationTolerance = 0.001,
  }) {
    try {
      final decoded = json.decode(geoJsonString);

      if (decoded is! Map || decoded['type'] != 'FeatureCollection') {
        throw FormatException('Invalid GeoJSON: not a FeatureCollection');
      }

      final features = decoded['features'] as List?;
      if (features == null) {
        throw FormatException('Invalid GeoJSON: missing features array');
      }

      final regions = <Region>[];

      for (final feature in features) {
        if (feature is! Map) continue;

        try {
          final properties = feature['properties'] as Map?;
          final geometry = feature['geometry'] as Map?;

          if (properties == null || geometry == null) {
            continue; // Skip invalid features
          }

          // Extract properties
          final id = feature['id']?.toString() ?? properties['id']?.toString();
          final name = properties['name']?.toString();
          final adminLevel = properties['admin_level'];

          if (id == null || name == null || adminLevel == null) {
            continue; // Skip features with missing required properties
          }

          // Simplify geometry if requested
          final processedGeometry = simplifyGeometry
              ? GeometrySimplifier.simplifyGeometry(
                  Map<String, dynamic>.from(geometry),
                  tolerance: simplificationTolerance,
                )
              : geometry;

          // Calculate centroid from geometry
          final centroid = _calculateCentroid(processedGeometry);

          // Convert geometry to JSON string for storage
          final geometryJson = json.encode(processedGeometry);

          // Create Region object
          final region = Region(
            id: id,
            countryCode: countryCode,
            name: name,
            adminLevel: adminLevel is int
                ? adminLevel
                : int.parse(adminLevel.toString()),
            centroid: centroid,
            geometryGeoJSON: geometryJson,
          );

          regions.add(region);
        } catch (e) {
          // Skip individual feature errors, continue processing
          print('Error parsing feature: $e');
          continue;
        }
      }

      if (regions.isEmpty) {
        throw FormatException('No valid regions found in GeoJSON');
      }

      return regions;
    } on FormatException catch (e) {
      throw Exception('Parse error: ${e.message}');
    } catch (e) {
      throw Exception('Error parsing GeoJSON features: $e');
    }
  }

  /// Calculate centroid from polygon geometry
  /// Supports Polygon and MultiPolygon types
  LatLng _calculateCentroid(Map geometry) {
    final type = geometry['type'] as String?;
    final coordinates = geometry['coordinates'] as List?;

    if (coordinates == null || coordinates.isEmpty) {
      throw FormatException('Invalid geometry: missing coordinates');
    }

    if (type == 'Polygon') {
      // For Polygon, coordinates[0] is the outer ring
      final ring = coordinates[0] as List;
      return _calculateRingCentroid(ring);
    } else if (type == 'MultiPolygon') {
      // For MultiPolygon, use the first polygon's outer ring
      final firstPolygon = coordinates[0] as List;
      final ring = firstPolygon[0] as List;
      return _calculateRingCentroid(ring);
    } else {
      throw FormatException('Unsupported geometry type: $type');
    }
  }

  /// Calculate centroid of a coordinate ring
  LatLng _calculateRingCentroid(List ring) {
    if (ring.isEmpty) {
      throw FormatException('Empty coordinate ring');
    }

    double sumLat = 0;
    double sumLng = 0;
    int count = 0;

    for (final coord in ring) {
      if (coord is List && coord.length >= 2) {
        sumLng += (coord[0] as num).toDouble();
        sumLat += (coord[1] as num).toDouble();
        count++;
      }
    }

    if (count == 0) {
      throw FormatException('No valid coordinates in ring');
    }

    return LatLng(sumLat / count, sumLng / count);
  }

  /// Apply admin level mapping rules to get display category
  String applyAdminLevelRules(String countryCode, int adminLevel) {
    final countryRules = adminLevelRules[countryCode];
    if (countryRules != null && countryRules.containsKey(adminLevel)) {
      return countryRules[adminLevel]!;
    }
    return 'Region'; // Default fallback
  }

  /// Check if cached pack exists for a country
  Future<bool> hasCachedPack(String countryCode) async {
    final cacheFile = await _getCacheFile(countryCode);
    return await cacheFile.exists();
  }

  /// Load GeoJSON pack with automatic fallback to cache
  /// Tries to fetch from network first, falls back to cache on failure
  Future<String> loadPack(String countryCode) async {
    try {
      // Try to fetch from network
      return await fetchPack(countryCode);
    } catch (e) {
      // Network failed, try cache
      try {
        return await getCachedPack(countryCode);
      } catch (cacheError) {
        // Both failed
        throw GeoJSONLoadException(
            'Failed to load GeoJSON pack: Network error and no cache available');
      }
    }
  }

  /// Load GeoJSON pack with retry logic
  /// Attempts to fetch with exponential backoff on failure
  Future<String> loadPackWithRetry(
    String countryCode, {
    int maxRetries = 3,
    Duration initialDelay = const Duration(seconds: 1),
  }) async {
    int attempt = 0;
    Duration delay = initialDelay;

    while (attempt < maxRetries) {
      try {
        return await loadPack(countryCode);
      } catch (e) {
        attempt++;
        if (attempt >= maxRetries) {
          rethrow;
        }

        // Wait before retrying with exponential backoff
        await Future.delayed(delay);
        delay *= 2; // Double the delay for next attempt
      }
    }

    throw GeoJSONLoadException('Failed after $maxRetries attempts');
  }

  /// Clear cache for a specific country
  Future<void> clearCache(String countryCode) async {
    final cacheFile = await _getCacheFile(countryCode);
    final etagFile = await _getETagFile(countryCode);

    if (await cacheFile.exists()) {
      await cacheFile.delete();
    }
    if (await etagFile.exists()) {
      await etagFile.delete();
    }
  }

  /// Clear all cached GeoJSON files
  Future<void> clearAllCache() async {
    final cacheDir = await _getCacheDirectory();
    if (await cacheDir.exists()) {
      await cacheDir.delete(recursive: true);
    }
  }
}
