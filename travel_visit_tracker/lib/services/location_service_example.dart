import 'package:flutter/material.dart';
import 'location_service.dart';
import '../models/region.dart';
import 'storage_service.dart';

/// Example usage of LocationService
/// This demonstrates how to initialize and use the location service
class LocationServiceExample {
  final LocationService _locationService = LocationService();
  final StorageService _storageService = StorageService();

  /// Initialize the location service and set up event listeners
  Future<void> initialize() async {
    // Initialize the location service
    _locationService.initialize();

    // Add event listener for region enter/exit events
    _locationService.addEventListener(_handleLocationEvent);

    // Request permissions
    final permissionStatus = await _locationService.requestPermissions();
    debugPrint('Permission status: $permissionStatus');

    // Restore monitored slots from storage
    await _restoreMonitoredSlots();
  }

  /// Handle location events (enter, exit, authorization changes)
  void _handleLocationEvent(LocationEvent event) {
    if (event.isEnter) {
      debugPrint('Entered region: ${event.regionId} at ${event.timestamp}');
      // Handle region enter - create visit candidate
      _onRegionEnter(event.regionId!, event.timestamp!);
    } else if (event.isExit) {
      debugPrint('Exited region: ${event.regionId} at ${event.timestamp}');
      // Handle region exit - cancel candidate or finalize visit
      _onRegionExit(event.regionId!, event.timestamp!);
    } else if (event.isAuthorizationChanged) {
      debugPrint('Authorization changed: ${event.status}');
      // Handle permission status change
      _onAuthorizationChanged(event.status!);
    } else if (event.isError) {
      debugPrint('Location error: ${event.error} for region ${event.regionId}');
      // Handle error
    }
  }

  /// Restore monitored slots from storage on app launch
  Future<void> _restoreMonitoredSlots() async {
    try {
      // Get monitored region IDs from storage
      final monitoredIds = await _storageService.getMonitoredSlots();

      if (monitoredIds.isNotEmpty) {
        // Get all regions from storage
        final allRegions = await _storageService.getAllRegions();

        // Restore monitoring
        await _locationService.restoreMonitoredSlots(monitoredIds, allRegions);
        debugPrint('Restored ${monitoredIds.length} monitored slots');
      }
    } catch (e) {
      debugPrint('Failed to restore monitored slots: $e');
    }
  }

  /// Start monitoring regions
  Future<void> startMonitoring(List<Region> regions) async {
    try {
      final result = await _locationService.startMonitoring(regions);
      debugPrint('Started monitoring ${result['count']} regions');
    } catch (e) {
      debugPrint('Failed to start monitoring: $e');
    }
  }

  /// Update monitored regions based on current location (20-slot rotation)
  Future<void> updateMonitoredRegions(List<Region> allRegions) async {
    try {
      final result = await _locationService.updateMonitoredRegions(allRegions);

      if (result['rotated'] == true) {
        debugPrint(
            'Rotated slots: unregistered ${result['unregistered']}, registered ${result['registered']}');

        // Persist the updated monitored region IDs
        final monitoredIds =
            List<String>.from(result['monitoredRegionIds'] as List);
        await _storageService.saveMonitoredSlots(monitoredIds);
      } else {
        debugPrint('Slot rotation skipped: ${result['reason']}');
      }
    } catch (e) {
      debugPrint('Failed to update monitored regions: $e');
    }
  }

  /// Get current monitoring status
  Future<void> getStatus() async {
    try {
      final status = await _locationService.getMonitoringStatus();
      debugPrint(
          'Monitoring ${status['count']} of ${status['maxRegions']} regions');
    } catch (e) {
      debugPrint('Failed to get status: $e');
    }
  }

  /// Handle region enter event
  void _onRegionEnter(String regionId, double timestamp) {
    // This would be implemented by the Visit Manager
    // Create a visit candidate and start dwell time tracking
  }

  /// Handle region exit event
  void _onRegionExit(String regionId, double timestamp) {
    // This would be implemented by the Visit Manager
    // Cancel candidate if dwell time < 300s, or finalize visit
  }

  /// Handle authorization status change
  void _onAuthorizationChanged(String status) {
    // Update UI to reflect permission status
    // Enable/disable visit tracking based on permission
  }

  /// Dispose the service
  void dispose() {
    _locationService.removeEventListener(_handleLocationEvent);
    _locationService.dispose();
  }
}
