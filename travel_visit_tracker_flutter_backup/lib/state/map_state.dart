import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter/foundation.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:geolocator/geolocator.dart';
import '../services/location_service.dart';
import '../services/database_service.dart';
import '../services/geojson_service.dart';
import '../services/local_db_service.dart';
import '../utils/path_smoothing.dart';
import 'package:image_picker/image_picker.dart';
import '../config/app_config.dart';
import '../theme/app_theme.dart';

class MapState extends ChangeNotifier {
  MaplibreMapController? _mapController;
  bool _isMapReady = false;
  
  final LocationService _locationService = LocationService();
  final DatabaseService _databaseService = DatabaseService();
  final GeoJSONService _geoJsonService = GeoJSONService();
  
  Position? _currentPosition;
  Position? get currentPosition => _currentPosition;

  bool get isMapReady => _isMapReady;

  MapState() {
    _initLocation();
  }

  Future<void> _initLocation() async {
    final hasPermission = await _locationService.requestPermission();
    if (hasPermission) {
      _locationService.startTracking();
      _locationService.positionStream.listen((position) {
        _currentPosition = position;
        notifyListeners();
      });
    }
  }

  void setMapController(MaplibreMapController controller) {
    _mapController = controller;
    notifyListeners();
  }

  void onStyleLoaded() {
    _isMapReady = true;
    debugPrint('MapState: Style loaded, map is ready');
    _loadRegions();
    _loadTripPath(); // Load the travel path
    notifyListeners();
  }

  Future<void> moveToUserLocation() async {
    if (_mapController != null && _currentPosition != null) {
      await _mapController!.animateCamera(
        CameraUpdate.newCameraPosition(
          CameraPosition(
            target: LatLng(_currentPosition!.latitude, _currentPosition!.longitude),
            zoom: AppConfig.selectZoomLevel,
          ),
        ),
      );
    }
  }

  Future<void> _loadRegions() async {
    if (!_isMapReady || _mapController == null) return;

    try {
      // Fetch KR regions
      final response = await http.get(Uri.parse('${AppConfig.apiBaseUrl}/geojson/KR'));
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        
        await _mapController!.addSource(
          'regions-source',
          GeojsonSourceProperties(data: data),
        );

        // Fill layer (lighter green)
        await _mapController!.addLayer(
          'regions-source',
          'regions-fill',
          const FillLayerProperties(
            fillColor: AppTheme.mapFillColor,
            fillOpacity: AppTheme.mapFillOpacity,
          ),
        );

        // Line layer (darker green border)
        await _mapController!.addLayer(
          'regions-source',
          'regions-line',
          const LineLayerProperties(
            lineColor: AppTheme.mapBorderColor,
            lineWidth: AppTheme.mapBorderWidth,
            lineOpacity: AppTheme.mapBorderOpacity,
          ),
        );
        
        debugPrint('MapState: Regions loaded and added to map');
      }
    } catch (e) {
      debugPrint('MapState: Error loading regions: $e');
    }
  }

  // Steps data for timeline
  List<Map<String, dynamic>> _steps = [];
  List<Map<String, dynamic>> get allSteps => _steps;

  // Load and render trip path from local DB
  Future<void> _loadTripPath() async {
    if (!_isMapReady || _mapController == null) return;

    try {
      final steps = await LocalDbService().getAllSteps();
      if (steps.isEmpty) return;
      
      _steps = steps;
      notifyListeners();

      List<Point> rawPoints = steps.map((step) {
        return Point(step['latitude'] as double, step['longitude'] as double);
      }).toList();

      // Apply smoothing (Catmull-Rom Spline)
      List<Point> smoothedPoints = PathSmoothingUtils.generateCatmullRomSpline(rawPoints, segments: 20);

      // Convert to GeoJSON LineString coordinates
      List<List<double>> coordinates = smoothedPoints.map((p) => [p.y, p.x]).toList(); // GeoJSON is [lng, lat]

      final geoJson = {
        'type': 'FeatureCollection',
        'features': [
          {
            'type': 'Feature',
            'properties': {},
            'geometry': {
              'type': 'LineString',
              'coordinates': coordinates,
            }
          }
        ]
      };

      // Remove existing source/layer if any (for refresh)
      try {
        await _mapController!.removeLayer('trip-path-layer');
        await _mapController!.removeSource('trip-path-source');
      } catch (e) {
        // Ignore if not exists
      }

      await _mapController!.addSource(
        'trip-path-source',
        GeojsonSourceProperties(data: geoJson),
      );

      await _mapController!.addLayer(
        'trip-path-source',
        'trip-path-layer',
        const LineLayerProperties(
          lineColor: '#FFC107', // Amber/Yellow color like Polarsteps
          lineWidth: 4.0,
          lineOpacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        ),
      );

      debugPrint('MapState: Trip path loaded with ${smoothedPoints.length} points');
    } catch (e) {
      debugPrint('MapState: Error loading trip path: $e');
    }
  }

  // Capture photo and save to timeline
  Future<void> capturePhoto() async {
    final picker = ImagePicker();
    final XFile? photo = await picker.pickImage(source: ImageSource.camera);
    
    if (photo != null && _currentPosition != null) {
      await LocalDbService().insertStep(
        tripId: 1, // Default trip ID for now
        latitude: _currentPosition!.latitude,
        longitude: _currentPosition!.longitude,
        timestamp: DateTime.now(),
        accuracy: _currentPosition!.accuracy,
        altitude: _currentPosition!.altitude,
        type: 'photo',
        photoPath: photo.path,
      );
      
      // Refresh the map path and timeline
      await _loadTripPath();
      notifyListeners();
      
       debugPrint('Photo saved: ${photo.path}');
    }
  }

  // Fly to specific location (for Timeline UI)
  Future<void> flyToLocation(double lat, double lng) async {
    if (_mapController != null) {
      await _mapController!.animateCamera(
        CameraUpdate.newCameraPosition(
          CameraPosition(
            target: LatLng(lat, lng),
            zoom: 16.0,
            tilt: 45.0, // Slight tilt for 3D effect
            bearing: 0,
          ),
        ),
        duration: const Duration(milliseconds: 1500), // Slow, cinematic fly-to
      );
    }
  }
}
