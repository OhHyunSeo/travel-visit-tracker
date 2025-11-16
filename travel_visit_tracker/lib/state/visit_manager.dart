import 'package:flutter/foundation.dart';
import '../services/location_service.dart';
import 'visit_state.dart';

/// Visit Manager coordinates between Location Service events and Visit State
/// This class acts as a bridge to connect location events to visit tracking
class VisitManager {
  final LocationService _locationService;
  final VisitState _visitState;

  // Callback for when a visit is confirmed (to trigger map updates)
  final Function(String regionId)? onVisitConfirmed;

  VisitManager({
    required LocationService locationService,
    required VisitState visitState,
    this.onVisitConfirmed,
  })  : _locationService = locationService,
        _visitState = visitState;

  /// Initialize the visit manager and start listening to location events
  void initialize() {
    _locationService.addEventListener(_handleLocationEvent);
  }

  /// Handle location events from the location service
  Future<void> _handleLocationEvent(LocationEvent event) async {
    if (event.isEnter) {
      await _handleRegionEnter(event);
    } else if (event.isExit) {
      await _handleRegionExit(event);
    } else if (event.isError) {
      _handleError(event);
    }
  }

  /// Handle region enter event
  Future<void> _handleRegionEnter(LocationEvent event) async {
    if (event.regionId == null) return;

    debugPrint('VisitManager: Region enter detected - ${event.regionId}');

    // Add candidate to visit state
    await _visitState.addCandidate(event.regionId!);

    // Listen for visit confirmation to trigger map update
    _visitState.addListener(() {
      if (_visitState.isVisited(event.regionId!) &&
          !_visitState.isCandidate(event.regionId!)) {
        // Visit was confirmed
        _triggerMapUpdate(event.regionId!);
      }
    });
  }

  /// Handle region exit event
  Future<void> _handleRegionExit(LocationEvent event) async {
    if (event.regionId == null) return;

    debugPrint('VisitManager: Region exit detected - ${event.regionId}');

    // Let visit state handle the exit logic (cancel if < 300s)
    await _visitState.onRegionExit(event.regionId!);
  }

  /// Handle error events
  void _handleError(LocationEvent event) {
    debugPrint('VisitManager: Location error - ${event.error}');
  }

  /// Trigger map style update when visit is confirmed
  void _triggerMapUpdate(String regionId) {
    debugPrint(
        'VisitManager: Visit confirmed for region $regionId - triggering map update');

    // Call the callback if provided
    onVisitConfirmed?.call(regionId);
  }

  /// Dispose and clean up listeners
  void dispose() {
    _locationService.removeEventListener(_handleLocationEvent);
  }
}
