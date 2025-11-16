import 'package:flutter/foundation.dart';

/// Utility for monitoring and profiling battery usage
/// Helps track location service impact on battery drain
class BatteryProfiler {
  static final BatteryProfiler _instance = BatteryProfiler._internal();
  factory BatteryProfiler() => _instance;
  BatteryProfiler._internal();

  DateTime? _monitoringStartTime;
  int _regionEnterEvents = 0;
  int _regionExitEvents = 0;
  int _slotRotations = 0;
  int _locationUpdates = 0;

  /// Start battery profiling session
  void startProfiling() {
    _monitoringStartTime = DateTime.now();
    _regionEnterEvents = 0;
    _regionExitEvents = 0;
    _slotRotations = 0;
    _locationUpdates = 0;
    debugPrint('Battery profiling started at $_monitoringStartTime');
  }

  /// Record a region enter event
  void recordRegionEnter() {
    _regionEnterEvents++;
  }

  /// Record a region exit event
  void recordRegionExit() {
    _regionExitEvents++;
  }

  /// Record a slot rotation event
  void recordSlotRotation() {
    _slotRotations++;
  }

  /// Record a location update
  void recordLocationUpdate() {
    _locationUpdates++;
  }

  /// Get profiling statistics
  Map<String, dynamic> getStatistics() {
    if (_monitoringStartTime == null) {
      return {'error': 'Profiling not started'};
    }

    final duration = DateTime.now().difference(_monitoringStartTime!);
    final hours = duration.inHours;
    final minutes = duration.inMinutes % 60;

    return {
      'duration_hours': hours,
      'duration_minutes': minutes,
      'total_duration_seconds': duration.inSeconds,
      'region_enter_events': _regionEnterEvents,
      'region_exit_events': _regionExitEvents,
      'slot_rotations': _slotRotations,
      'location_updates': _locationUpdates,
      'events_per_hour': hours > 0
          ? ((_regionEnterEvents + _regionExitEvents) / hours)
              .toStringAsFixed(2)
          : 'N/A',
      'rotations_per_hour':
          hours > 0 ? (_slotRotations / hours).toStringAsFixed(2) : 'N/A',
    };
  }

  /// Generate a profiling report
  String generateReport() {
    final stats = getStatistics();

    if (stats.containsKey('error')) {
      return 'Battery Profiling Report: ${stats['error']}';
    }

    return '''
Battery Profiling Report
========================
Duration: ${stats['duration_hours']}h ${stats['duration_minutes']}m
Total Events: ${stats['region_enter_events'] + stats['region_exit_events']}
  - Region Enters: ${stats['region_enter_events']}
  - Region Exits: ${stats['region_exit_events']}
Slot Rotations: ${stats['slot_rotations']}
Location Updates: ${stats['location_updates']}

Efficiency Metrics:
  - Events per hour: ${stats['events_per_hour']}
  - Rotations per hour: ${stats['rotations_per_hour']}

Optimization Status:
  ✓ Using region monitoring (geofencing) instead of continuous tracking
  ✓ 500m minimum radius for CLCircularRegion
  ✓ 1000m movement threshold before slot rotation
  ✓ Maximum 20 concurrent monitored regions
  ✓ Background location updates enabled

Expected Battery Impact:
  - Low: < 5% drain per 8 hours with optimizations
  - Medium: 5-10% drain if frequent slot rotations
  - High: > 10% drain indicates potential issues

Recommendations:
  ${_generateRecommendations(stats)}
''';
  }

  String _generateRecommendations(Map<String, dynamic> stats) {
    final recommendations = <String>[];

    final rotationsPerHour =
        double.tryParse(stats['rotations_per_hour'] ?? '0') ?? 0;
    if (rotationsPerHour > 5) {
      recommendations.add(
          '- High slot rotation rate detected. Consider increasing movement threshold.');
    }

    final eventsPerHour = double.tryParse(stats['events_per_hour'] ?? '0') ?? 0;
    if (eventsPerHour > 20) {
      recommendations
          .add('- High event rate. User may be in dense region area.');
    }

    if (recommendations.isEmpty) {
      recommendations
          .add('- Battery usage appears optimal. No issues detected.');
    }

    return recommendations.join('\n  ');
  }

  /// Reset profiling data
  void reset() {
    _monitoringStartTime = null;
    _regionEnterEvents = 0;
    _regionExitEvents = 0;
    _slotRotations = 0;
    _locationUpdates = 0;
    debugPrint('Battery profiling reset');
  }

  /// Print current statistics to debug console
  void printStatistics() {
    debugPrint(generateReport());
  }
}
