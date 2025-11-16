import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/visit_candidate.dart';
import '../services/storage_service.dart';
import '../services/stats_manager.dart';

class VisitState extends ChangeNotifier {
  final StorageService _storageService = StorageService();

  // Map of region ID to visit candidate
  final Map<String, VisitCandidate> _candidates = {};

  // List of confirmed visit region IDs
  final List<String> _confirmedVisits = [];

  // Map of region ID to Timer for dwell time checking
  final Map<String, Timer> _dwellTimers = {};

  // Callback for badge notifications
  Function(VisitBadge)? onBadgeEarned;

  // Tracking enabled flag
  bool _trackingEnabled = false;

  // Getters
  Map<String, VisitCandidate> get candidates => Map.unmodifiable(_candidates);
  List<String> get confirmedVisits => List.unmodifiable(_confirmedVisits);
  bool get isTrackingEnabled => _trackingEnabled;

  /// Initialize the visit state by loading existing candidates from storage
  Future<void> initialize() async {
    final storedCandidates = await _storageService.getVisitCandidates();

    for (final candidate in storedCandidates) {
      _candidates[candidate.regionId] = candidate;

      // Check if candidate should already be confirmed
      if (candidate.isConfirmed) {
        await confirmVisit(candidate.regionId);
      } else {
        // Set up timer for remaining dwell time
        final remainingTime = 300 - candidate.dwellTime.inSeconds;
        if (remainingTime > 0) {
          _startDwellTimer(
              candidate.regionId, Duration(seconds: remainingTime));
        }
      }
    }

    notifyListeners();
  }

  /// Enable visit tracking
  void enableTracking() {
    _trackingEnabled = true;
    notifyListeners();
  }

  /// Disable visit tracking
  void disableTracking() {
    _trackingEnabled = false;
    notifyListeners();
  }

  /// Add a visit candidate when user enters a region
  Future<void> addCandidate(String regionId) async {
    // Don't add if tracking is disabled
    if (!_trackingEnabled) {
      return;
    }

    // Don't add if already confirmed or already a candidate
    if (_confirmedVisits.contains(regionId) ||
        _candidates.containsKey(regionId)) {
      return;
    }

    final now = DateTime.now();
    final candidate = VisitCandidate(
      regionId: regionId,
      enterTime: now,
      lastUpdate: now,
    );

    _candidates[regionId] = candidate;

    // Save to database
    await _storageService.saveVisitCandidate(candidate);

    // Start 300-second dwell timer
    _startDwellTimer(regionId, const Duration(seconds: 300));

    notifyListeners();
  }

  /// Start a timer to check dwell time and auto-confirm after 300 seconds
  void _startDwellTimer(String regionId, Duration duration) {
    _dwellTimers[regionId]?.cancel();

    _dwellTimers[regionId] = Timer(duration, () async {
      if (_candidates.containsKey(regionId)) {
        await confirmVisit(regionId);
      }
    });
  }

  /// Confirm a visit (promote candidate to confirmed status)
  Future<void> confirmVisit(String regionId) async {
    final candidate = _candidates[regionId];
    if (candidate == null) return;

    // Get previous visit count for badge checking
    final statsManager = StatsManager();
    final previousVisitCount = await statsManager.getTotalVisited();

    // Remove from candidates
    _candidates.remove(regionId);
    _dwellTimers[regionId]?.cancel();
    _dwellTimers.remove(regionId);

    // Add to confirmed visits
    if (!_confirmedVisits.contains(regionId)) {
      _confirmedVisits.add(regionId);
    }

    // Mark region as visited in database
    await _storageService.markVisited(regionId, DateTime.now());

    // Delete candidate from database
    await _storageService.deleteVisitCandidate(regionId);

    // Check for new badge
    final newBadge = await statsManager.checkNewBadge(previousVisitCount);
    if (newBadge != null && onBadgeEarned != null) {
      // Save badge to app_state
      final currentBadges = await _storageService.getAppState('earned_badges');
      final badgeList = currentBadges?.split(',') ?? [];
      if (!badgeList.contains(newBadge.name)) {
        badgeList.add(newBadge.name);
        await _storageService.setAppState('earned_badges', badgeList.join(','));
      }

      // Trigger callback
      onBadgeEarned!(newBadge);
    }

    notifyListeners();
  }

  /// Handle region exit event
  Future<void> onRegionExit(String regionId) async {
    final candidate = _candidates[regionId];
    if (candidate == null) return;

    // Check if dwell time is less than 300 seconds
    if (candidate.dwellTime.inSeconds < 300) {
      // Cancel the candidate
      await cancelCandidate(regionId);
    }
    // If dwell time >= 300 seconds, the visit is already confirmed or will be confirmed by timer
  }

  /// Cancel a visit candidate
  Future<void> cancelCandidate(String regionId) async {
    if (!_candidates.containsKey(regionId)) return;

    // Remove from candidates
    _candidates.remove(regionId);

    // Cancel timer
    _dwellTimers[regionId]?.cancel();
    _dwellTimers.remove(regionId);

    // Delete from database
    await _storageService.deleteVisitCandidate(regionId);

    notifyListeners();
  }

  /// Update candidate's last update timestamp
  Future<void> updateCandidate(String regionId) async {
    final candidate = _candidates[regionId];
    if (candidate == null) return;

    candidate.lastUpdate = DateTime.now();

    // Save to database
    await _storageService.saveVisitCandidate(candidate);

    notifyListeners();
  }

  /// Check if a region has been visited
  bool isVisited(String regionId) {
    return _confirmedVisits.contains(regionId);
  }

  /// Check if a region is currently a candidate
  bool isCandidate(String regionId) {
    return _candidates.containsKey(regionId);
  }

  @override
  void dispose() {
    // Cancel all timers
    for (final timer in _dwellTimers.values) {
      timer.cancel();
    }
    _dwellTimers.clear();
    super.dispose();
  }
}
