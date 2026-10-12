import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter/foundation.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import '../models/region.dart';

class GeoJSONService {
  // Simulator localhost for Android is 10.0.2.2, for iOS is localhost
  static const String _baseUrl = 'http://localhost:3000/api';

  Future<List<Region>> fetchRegions(String countryCode) async {
    try {
      final response = await http.get(Uri.parse('$_baseUrl/geojson/$countryCode'));

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        return _parseGeoJSON(data, countryCode);
      } else {
        throw Exception('Failed to load GeoJSON: ${response.statusCode}');
      }
    } catch (e) {
      debugPrint('Error fetching regions: $e');
      rethrow;
    }
  }

  List<Region> _parseGeoJSON(Map<String, dynamic> data, String countryCode) {
    final features = data['features'] as List;
    return features.map((feature) {
      final properties = feature['properties'];
      final geometry = feature['geometry'];
      
      // Create Region object
      return Region(
        id: feature['id']?.toString() ?? properties['id'].toString(),
        name: properties['name'],
        // Store geometry as JSON string for now, or process it if needed
        // For this simple version, we might not store full geometry in Region model 
        // if we just pass it to the map, but let's keep it simple.
      );
    }).toList();
  }
  
  // Helper to convert GeoJSON features to MapLibre source data
  Map<String, dynamic> convertToGeoJSONSource(List<Region> regions, Map<String, dynamic> originalGeoJSON) {
    // In a real app, we might merge "visited" status here.
    // For now, we just return the original GeoJSON or a modified version.
    return originalGeoJSON;
  }
}
