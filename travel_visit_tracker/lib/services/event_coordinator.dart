import 'package:flutter/foundation.dart';
import '../state/visit_state.dart';
import '../state/map_state.dart';
import '../services/location_service.dart';
import '../services/storage_service.dart';

/// Coordinates event flows between services and state providers
class EventCoordinator {
  final LocationService _locationService;
  final VisitState _visitState;
  final MapState _mapState;

  EventCoordinator({
    required LocationService locationService,
    required VisitState visitState,
    required MapState mapState,
    required StorageService storageService,
  })  : _locationService = locationService,
        _visitState = visitState,
        _mapState = mapState;

  /// Initialize event flow connections
  void initialize() {
    _connectLocationToVisit();
    _connectVisitToMap();
    _connectPhotoToRegion();
  }

  /// Wire LocationService events to VisitState
  void _connectLocationToVisit() {
    _locationService.addEventListener((event) {
      if (event.isEnter && event.regionId != null) {
        // Region enter event - create visit candidate
        _visitState.addCandidate(event.regionId!);
        if (kDebugMode) {
          print('EventCoordinator: Region enter detected - ${event.regionId}');
        }
      } else if (event.isExit && event.regionId != null) {
        // Region exit event - handle candidate cancellation
        _visitState.onRegionExit(event.regionId!);
        if (kDebugMode) {
          print('EventCoordinator: Region exit detected - ${event.regionId}');
        }
      } else if (event.isAuthorizationChanged) {
        // Permission status changed
        if (kDebugMode) {
          print('EventCoordinator: Authorization changed - ${event.status}');
        }
        // Enable/disable tracking based on permission
        if (event.status == 'authorizedAlways' ||
            event.status == 'authorizedWhenInUse') {
          _visitState.enableTracking();
        } else {
          _visitState.disableTracking();
        }
      }
    });
  }

  /// Connect VisitState confirmations to MapState updates
  void _connectVisitToMap() {
    // Listen to visit state changes
    _visitState.addListener(() async {
      // When a visit is confirmed, update the map
      final confirmedVisits = _visitState.confirmedVisits;

      for (final regionId in confirmedVisits) {
        final region = _mapState.getRegion(regionId);
        if (region != null && !region.visited) {
          // Update map state to show region as visited
          await _mapState.updateRegionVisitStatus(regionId, true);

          if (kDebugMode) {
            print(
                'EventCoordinator: Updated map for confirmed visit - $regionId');
          }
        }
      }
    });
  }

  /// Link photo uploads to region metadata updates
  void _connectPhotoToRegion() {
    // This connection is handled through the PhotoService and RegionDetailPanel
    // When a photo is uploaded, the PhotoService updates the storage
    // and the region detail panel refreshes to show the new photo
    // No additional wiring needed here as it's handled in the UI layer
  }

  /// Dispose event listeners
  void dispose() {
    // Location service listeners are managed by the service itself
    // State listeners are managed by the state providers
  }
}
