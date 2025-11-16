import 'package:flutter/material.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import '../services/geojson_service.dart';
import '../services/storage_service.dart';
import '../services/location_service.dart';
import '../utils/error_handler.dart';
import '../widgets/error_retry_widget.dart';

/// Example of MapScreen with comprehensive error handling
class MapScreenWithErrorHandling extends StatefulWidget {
  const MapScreenWithErrorHandling({super.key});

  @override
  State<MapScreenWithErrorHandling> createState() =>
      _MapScreenWithErrorHandlingState();
}

class _MapScreenWithErrorHandlingState
    extends State<MapScreenWithErrorHandling> {
  final GeoJSONService _geoJsonService = GeoJSONService();
  final StorageService _storageService = StorageService();
  final LocationService _locationService = LocationService();

  MaplibreMapController? _mapController;
  bool _isLoading = true;
  String? _errorMessage;
  String _currentCountry = 'KR';

  @override
  void initState() {
    super.initState();
    _initializeMap();
  }

  Future<void> _initializeMap() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      // Check database health first
      final isHealthy = await _storageService.checkDatabaseHealth();
      if (!isHealthy) {
        await _handleDatabaseCorruption();
        return;
      }

      // Load GeoJSON with retry
      await _loadGeoJSON(_currentCountry);

      // Request location permissions
      await _requestLocationPermission();

      setState(() {
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = ErrorHandler.getUserFriendlyMessage(e);
      });
    }
  }

  Future<void> _loadGeoJSON(String countryCode) async {
    try {
      // Try to load with retry logic
      final geoJsonString = await _geoJsonService.loadPackWithRetry(
        countryCode,
        maxRetries: 3,
      );

      // Parse features
      final regions = _geoJsonService.parseFeatures(geoJsonString, countryCode);

      // Save to database
      await _storageService.saveRegions(regions);

      // Add to map if controller is ready
      if (_mapController != null) {
        await _addGeoJSONToMap(geoJsonString);
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Loaded ${regions.length} regions'),
            backgroundColor: Colors.green,
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } on GeoJSONNetworkException catch (e) {
      // Try cache fallback
      final hasCached = await _geoJsonService.hasCachedPack(countryCode);
      if (hasCached) {
        final cachedData = await _geoJsonService.getCachedPack(countryCode);
        final regions = _geoJsonService.parseFeatures(cachedData, countryCode);
        await _storageService.saveRegions(regions);

        if (_mapController != null) {
          await _addGeoJSONToMap(cachedData);
        }

        if (mounted) {
          ErrorHandler.showErrorSnackbar(
            context,
            'Using cached data. Unable to update.',
          );
        }
      } else {
        throw GeoJSONLoadException(
            'Network error and no cache available: ${e.message}');
      }
    }
  }

  Future<void> _addGeoJSONToMap(String geoJsonString) async {
    if (_mapController == null) return;

    try {
      // Add GeoJSON source
      await _mapController!.addSource(
        'regions',
        GeojsonSourceProperties(data: geoJsonString),
      );

      // Add fill layer
      await _mapController!.addLayer(
        'regions',
        'regions-fill',
        const FillLayerProperties(
          fillColor: [
            'case',
            ['get', 'visited'],
            '#4CAF50',
            '#BDBDBD',
          ],
          fillOpacity: [
            'case',
            ['get', 'visited'],
            0.6,
            0.3,
          ],
        ),
      );
    } catch (e) {
      debugPrint('Error adding GeoJSON to map: $e');
      rethrow;
    }
  }

  Future<void> _requestLocationPermission() async {
    try {
      final status = await _locationService.requestPermissions();

      if (status == 'denied' || status == 'restricted') {
        if (mounted) {
          _showPermissionDeniedDialog();
        }
      } else if (status == 'authorizedAlways' ||
          status == 'authorizedWhenInUse') {
        // Start monitoring
        final regions = await _storageService.getAllRegions();
        if (regions.isNotEmpty) {
          try {
            await _locationService.startMonitoring(
              regions.take(20).toList(),
            );
          } on RegionMonitoringLimitException {
            if (mounted) {
              ErrorHandler.showErrorSnackbar(
                context,
                'Monitoring limit reached. App will manage regions automatically.',
              );
            }
          }
        }
      }
    } on LocationPermissionException {
      if (mounted) {
        _showPermissionDeniedDialog();
      }
    } catch (e) {
      debugPrint('Error requesting location permission: $e');
    }
  }

  void _showPermissionDeniedDialog() {
    showDialog(
      context: context,
      builder: (context) => PermissionDeniedWidget(
        onOpenSettings: () {
          Navigator.of(context).pop();
          // Open settings - would use app_settings plugin
        },
      ),
    );
  }

  Future<void> _handleDatabaseCorruption() async {
    final shouldRebuild = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => DatabaseErrorWidget(
        onRebuild: () => Navigator.of(context).pop(true),
        onCancel: () => Navigator.of(context).pop(false),
      ),
    );

    if (shouldRebuild == true) {
      try {
        await _storageService.rebuildDatabase();

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Database rebuilt successfully'),
              backgroundColor: Colors.green,
            ),
          );
        }

        // Retry initialization
        await _initializeMap();
      } catch (e) {
        if (mounted) {
          ErrorHandler.showErrorSnackbar(
            context,
            'Failed to rebuild database: ${e.toString()}',
          );
        }
      }
    }
  }

  void _onMapCreated(MaplibreMapController controller) {
    _mapController = controller;
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        body: LoadingWidget(message: 'Loading map...'),
      );
    }

    if (_errorMessage != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Map')),
        body: GeoJSONErrorWidget(
          countryCode: _currentCountry,
          errorMessage: _errorMessage!,
          onRetry: _initializeMap,
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Travel Map'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => _loadGeoJSON(_currentCountry),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: MaplibreMap(
        onMapCreated: _onMapCreated,
        initialCameraPosition: const CameraPosition(
          target: LatLng(37.5665, 126.9780), // Seoul
          zoom: 10,
        ),
        onStyleLoadedCallback: () async {
          // Load GeoJSON after style is loaded
          try {
            final geoJsonString =
                await _geoJsonService.getCachedPack(_currentCountry);
            await _addGeoJSONToMap(geoJsonString);
          } catch (e) {
            debugPrint('Error loading cached GeoJSON: $e');
          }
        },
      ),
    );
  }

  @override
  void dispose() {
    _mapController?.dispose();
    super.dispose();
  }
}
