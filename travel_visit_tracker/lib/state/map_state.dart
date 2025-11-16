import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import '../models/region.dart';
import '../services/geojson_service.dart';
import '../services/ad_service.dart';
import 'ad_state.dart';

class MapState extends ChangeNotifier {
  final GeoJSONService _geoJsonService = GeoJSONService();
  final AdService? _adService;
  final AdState? _adState;

  MaplibreMapController? _mapController;
  final Map<String, Region> _regions = {};
  String? _selectedRegionId;
  LatLng? _userLocation;
  bool _styleLoaded = false;

  MapState({AdService? adService, AdState? adState})
      : _adService = adService,
        _adState = adState;

  // Getters
  Map<String, Region> get regions => Map.unmodifiable(_regions);
  String? get selectedRegionId => _selectedRegionId;
  Region? get selectedRegion =>
      _selectedRegionId != null ? _regions[_selectedRegionId] : null;
  LatLng? get userLocation => _userLocation;
  bool get isMapReady => _mapController != null && _styleLoaded;

  /// Set the map controller reference
  void setMapController(MaplibreMapController controller) {
    _mapController = controller;
    notifyListeners();
  }

  /// Called when map style is loaded
  void onStyleLoaded() {
    _styleLoaded = true;
    notifyListeners();
  }

  /// Load regions from GeoJSON pack for a specific country
  Future<void> loadRegions(String countryCode) async {
    try {
      // Load GeoJSON string from service
      final geoJsonString = await _geoJsonService.loadPack(countryCode);

      // Parse features to Region models
      final regions = _geoJsonService.parseFeatures(geoJsonString, countryCode);

      // Store regions in map
      for (final region in regions) {
        _regions[region.id] = region;
      }

      // Add GeoJSON to map if map is ready
      if (isMapReady) {
        await _addGeoJSONToMap(regions);
      }

      notifyListeners();
    } catch (e) {
      debugPrint('Error loading regions: $e');
      rethrow;
    }
  }

  /// Add GeoJSON source and fill layer to the map
  Future<void> _addGeoJSONToMap(List<Region> regions) async {
    if (_mapController == null) return;

    try {
      // Build GeoJSON FeatureCollection
      final features = regions.map((region) {
        // Parse the geometry JSON string back to a Map
        final geometryMap =
            json.decode(region.geometryGeoJSON) as Map<String, dynamic>;

        return {
          'type': 'Feature',
          'id': region.id,
          'properties': {
            'id': region.id,
            'name': region.name,
            'visited': region.visited,
          },
          'geometry': geometryMap,
        };
      }).toList();

      final geoJson = {
        'type': 'FeatureCollection',
        'features': features,
      };

      // Add source
      await _mapController!.addSource(
        'regions-source',
        GeojsonSourceProperties(data: geoJson),
      );

      // Add fill layer with expression-based styling
      await _mapController!.addLayer(
        'regions-source',
        'regions-fill',
        FillLayerProperties(
          fillColor: [
            'case',
            ['get', 'visited'],
            '#4CAF50', // visited = true
            '#BDBDBD', // visited = false
          ],
          fillOpacity: [
            'case',
            ['get', 'visited'],
            0.6, // visited = true
            0.3, // visited = false
          ],
        ),
      );

      // Add line layer for borders
      await _mapController!.addLayer(
        'regions-source',
        'regions-line',
        LineLayerProperties(
          lineColor: '#757575',
          lineWidth: 1.0,
          lineOpacity: 0.5,
        ),
      );
    } catch (e) {
      debugPrint('Error adding GeoJSON to map: $e');
      rethrow;
    }
  }

  /// Update region visit status and refresh map styling
  Future<void> updateRegionVisitStatus(String regionId, bool visited) async {
    final region = _regions[regionId];
    if (region == null) return;

    region.visited = visited;
    region.visitedAt = visited ? DateTime.now() : null;

    // Update the map layer by refreshing the source data
    if (isMapReady) {
      await _refreshMapSource();
    }

    notifyListeners();
  }

  /// Refresh the GeoJSON source with updated region data
  Future<void> _refreshMapSource() async {
    if (_mapController == null) return;

    try {
      // Rebuild GeoJSON with updated data
      final features = _regions.values.map((region) {
        // Parse the geometry JSON string back to a Map
        final geometryMap =
            json.decode(region.geometryGeoJSON) as Map<String, dynamic>;

        return {
          'type': 'Feature',
          'id': region.id,
          'properties': {
            'id': region.id,
            'name': region.name,
            'visited': region.visited,
          },
          'geometry': geometryMap,
        };
      }).toList();

      final geoJson = {
        'type': 'FeatureCollection',
        'features': features,
      };

      // Update the source
      await _mapController!.setGeoJsonSource('regions-source', geoJson);
    } catch (e) {
      debugPrint('Error refreshing map source: $e');
    }
  }

  /// Select a region to show detail panel
  Future<void> selectRegion(String? regionId) async {
    // If selecting a region (not deselecting) and ads are configured
    if (regionId != null && _adService != null && _adState != null) {
      // Show interstitial ad if not shown this session and ad is ready
      if (!_adState.interstitialShownThisSession &&
          _adService.isInterstitialAdReady) {
        try {
          await _adService.showInterstitialAd();
          _adState.markInterstitialShown();
        } catch (e) {
          if (kDebugMode) {
            print('MapState: Failed to show interstitial ad: $e');
          }
          // Continue even if ad fails
        }
      }
    }

    _selectedRegionId = regionId;
    notifyListeners();
  }

  /// Update user location
  void updateUserLocation(LatLng location) {
    _userLocation = location;
    notifyListeners();
  }

  /// Get region by ID
  Region? getRegion(String regionId) {
    return _regions[regionId];
  }

  /// Clear all regions
  void clearRegions() {
    _regions.clear();
    _selectedRegionId = null;
    notifyListeners();
  }
}
