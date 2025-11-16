import 'dart:async';
import 'package:flutter/services.dart';
import '../models/region.dart';
import '../utils/battery_profiler.dart';

enum LocationPermissionStatus {
  notDetermined,
  restricted,
  denied,
  authorizedWhenInUse,
  authorizedAlways,
  unknown,
}

/// Custom exceptions for location service
class LocationServiceException implements Exception {
  final String message;
  LocationServiceException(this.message);

  @override
  String toString() => 'LocationServiceException: $message';
}

class RegionMonitoringLimitException extends LocationServiceException {
  RegionMonitoringLimitException(super.message);
}

class LocationPermissionException extends LocationServiceException {
  LocationPermissionException(super.message);
}

class LocationEvent {
  final String type;
  final String? regionId;
  final double? timestamp;
  final double? lat;
  final double? lng;
  final String? status;
  final String? error;

  LocationEvent({
    required this.type,
    this.regionId,
    this.timestamp,
    this.lat,
    this.lng,
    this.status,
    this.error,
  });

  factory LocationEvent.fromMap(Map<dynamic, dynamic> map) {
    return LocationEvent(
      type: map['type'] as String,
      regionId: map['regionId'] as String?,
      timestamp: map['timestamp'] as double?,
      lat: map['lat'] as double?,
      lng: map['lng'] as double?,
      status: map['status'] as String?,
      error: map['error'] as String?,
    );
  }

  bool get isEnter => type == 'enter';
  bool get isExit => type == 'exit';
  bool get isAuthorizationChanged => type == 'authorizationChanged';
  bool get isError => type == 'error';
}

class LocationService {
  static const MethodChannel _methodChannel =
      MethodChannel('com.travelvisittracker/location');
  static const EventChannel _eventChannel =
      EventChannel('com.travelvisittracker/location_events');

  Stream<LocationEvent>? _eventStream;
  StreamSubscription<LocationEvent>? _eventSubscription;
  final List<Function(LocationEvent)> _eventListeners = [];
  final BatteryProfiler _batteryProfiler = BatteryProfiler();

  // Singleton pattern
  static final LocationService _instance = LocationService._internal();
  factory LocationService() => _instance;
  LocationService._internal();

  /// Initialize the location service and start listening to events
  void initialize() {
    _eventStream = _eventChannel
        .receiveBroadcastStream()
        .map((event) => LocationEvent.fromMap(event as Map));

    _eventSubscription = _eventStream!.listen((event) {
      // Record events for battery profiling
      if (event.isEnter) {
        _batteryProfiler.recordRegionEnter();
      } else if (event.isExit) {
        _batteryProfiler.recordRegionExit();
      }

      for (var listener in _eventListeners) {
        listener(event);
      }
    });
  }

  /// Add a listener for location events
  void addEventListener(Function(LocationEvent) listener) {
    _eventListeners.add(listener);
  }

  /// Remove a listener
  void removeEventListener(Function(LocationEvent) listener) {
    _eventListeners.remove(listener);
  }

  /// Dispose the service
  void dispose() {
    _eventSubscription?.cancel();
    _eventListeners.clear();
  }

  /// Request location permissions
  /// Returns the current permission status
  Future<String> requestPermissions() async {
    try {
      final result = await _methodChannel.invokeMethod('requestPermissions');
      return result as String;
    } on PlatformException catch (e) {
      if (e.code == 'PERMISSION_DENIED') {
        throw LocationPermissionException('Location permission denied by user');
      }
      throw LocationServiceException(
          'Failed to request permissions: ${e.message}');
    }
  }

  /// Start monitoring a list of regions
  Future<Map<String, dynamic>> startMonitoring(List<Region> regions) async {
    try {
      // Enforce 20-region limit
      if (regions.length > 20) {
        throw RegionMonitoringLimitException(
            'Cannot monitor more than 20 regions. Requested: ${regions.length}');
      }

      final regionsData = regions.map((region) {
        return {
          'id': region.id,
          'lat': region.centroid.latitude,
          'lng': region.centroid.longitude,
          'radius': 500.0, // Default 500m radius
        };
      }).toList();

      final result = await _methodChannel.invokeMethod('startMonitoring', {
        'regions': regionsData,
      });

      return Map<String, dynamic>.from(result as Map);
    } on PlatformException catch (e) {
      if (e.code == 'REGION_MONITORING_LIMIT_EXCEEDED' ||
          e.message?.contains('limit') == true) {
        throw RegionMonitoringLimitException(
            'Region monitoring limit exceeded: ${e.message}');
      }
      throw LocationServiceException(
          'Failed to start monitoring: ${e.message}');
    }
  }

  /// Stop monitoring specific regions
  Future<Map<String, dynamic>> stopMonitoring(List<String> regionIds) async {
    try {
      final result = await _methodChannel.invokeMethod('stopMonitoring', {
        'regionIds': regionIds,
      });

      return Map<String, dynamic>.from(result as Map);
    } on PlatformException catch (e) {
      throw LocationServiceException('Failed to stop monitoring: ${e.message}');
    }
  }

  /// Get current monitoring status
  Future<Map<String, dynamic>> getMonitoringStatus() async {
    try {
      final result = await _methodChannel.invokeMethod('getMonitoringStatus');
      return Map<String, dynamic>.from(result as Map);
    } on PlatformException catch (e) {
      throw LocationServiceException(
          'Failed to get monitoring status: ${e.message}');
    }
  }

  /// Get current location
  Future<Map<String, dynamic>> getCurrentLocation() async {
    try {
      final result = await _methodChannel.invokeMethod('getCurrentLocation');
      return Map<String, dynamic>.from(result as Map);
    } on PlatformException catch (e) {
      if (e.code == 'PERMISSION_DENIED') {
        throw LocationPermissionException('Location permission not granted');
      }
      throw LocationServiceException(
          'Failed to get current location: ${e.message}');
    }
  }

  /// Update monitored regions based on current location
  /// Implements the 20-slot rotation algorithm
  Future<Map<String, dynamic>> updateMonitoredRegions(
      List<Region> allRegions) async {
    try {
      final regionsData = allRegions.map((region) {
        return {
          'id': region.id,
          'lat': region.centroid.latitude,
          'lng': region.centroid.longitude,
          'radius': 500.0,
        };
      }).toList();

      final result =
          await _methodChannel.invokeMethod('updateMonitoredRegions', {
        'allRegions': regionsData,
      });

      final resultMap = Map<String, dynamic>.from(result as Map);

      // Record slot rotation for battery profiling
      if (resultMap['rotated'] == true) {
        _batteryProfiler.recordSlotRotation();
      }

      return resultMap;
    } on PlatformException catch (e) {
      if (e.code == 'REGION_MONITORING_LIMIT_EXCEEDED' ||
          e.message?.contains('limit') == true) {
        throw RegionMonitoringLimitException(
            'Region monitoring limit exceeded: ${e.message}');
      }
      throw LocationServiceException(
          'Failed to update monitored regions: ${e.message}');
    }
  }

  /// Restore monitored slots from storage on app launch
  Future<void> restoreMonitoredSlots(
      List<String> regionIds, List<Region> allRegions) async {
    // Find the regions that match the stored IDs
    final regionsToMonitor =
        allRegions.where((region) => regionIds.contains(region.id)).toList();

    if (regionsToMonitor.isNotEmpty) {
      await startMonitoring(regionsToMonitor);
    }
  }

  /// Get battery profiler instance for monitoring
  BatteryProfiler get batteryProfiler => _batteryProfiler;

  /// Start battery profiling session
  void startBatteryProfiling() {
    _batteryProfiler.startProfiling();
  }

  /// Get battery profiling report
  String getBatteryProfilingReport() {
    return _batteryProfiler.generateReport();
  }

  /// Print battery statistics to console
  void printBatteryStatistics() {
    _batteryProfiler.printStatistics();
  }
}
