import 'package:flutter/foundation.dart';
import '../services/stats_manager.dart';
import '../services/storage_service.dart';

/// Manages badge state and notifications
class BadgeState extends ChangeNotifier {
  final StatsManager _statsManager = StatsManager();
  final StorageService _storageService = StorageService();

  List<VisitBadge> _earnedBadges = [];
  int _previousVisitCount = 0;

  List<VisitBadge> get earnedBadges => List.unmodifiable(_earnedBadges);

  /// Initialize badge state by loading from storage
  Future<void> initialize() async {
    await _loadBadgeState();
    _previousVisitCount = await _statsManager.getTotalVisited();
  }

  /// Load badge state from app_state table
  Future<void> _loadBadgeState() async {
    final badgeState = await _storageService.getAppState('earned_badges');

    if (badgeState != null) {
      // Parse comma-separated badge names
      final badgeNames = badgeState.split(',');
      _earnedBadges = VisitBadge.values
          .where((badge) => badgeNames.contains(badge.name))
          .toList();
    } else {
      // First time - check current badges
      _earnedBadges = await _statsManager.checkBadges();
      await _saveBadgeState();
    }

    notifyListeners();
  }

  /// Save badge state to app_state table
  Future<void> _saveBadgeState() async {
    final badgeNames = _earnedBadges.map((b) => b.name).join(',');
    await _storageService.setAppState('earned_badges', badgeNames);
  }

  /// Check for new badges after a visit confirmation
  /// Returns the newly earned badge if any
  Future<VisitBadge?> checkForNewBadge() async {
    final currentVisitCount = await _statsManager.getTotalVisited();
    final newBadge = await _statsManager.checkNewBadge(_previousVisitCount);

    if (newBadge != null && !_earnedBadges.contains(newBadge)) {
      _earnedBadges.add(newBadge);
      await _saveBadgeState();
      notifyListeners();
    }

    _previousVisitCount = currentVisitCount;
    return newBadge;
  }

  /// Refresh badge state (useful after manual data changes)
  Future<void> refresh() async {
    _earnedBadges = await _statsManager.checkBadges();
    await _saveBadgeState();
    _previousVisitCount = await _statsManager.getTotalVisited();
    notifyListeners();
  }

  /// Check if a specific badge is earned
  bool hasBadge(VisitBadge badge) {
    return _earnedBadges.contains(badge);
  }

  /// Get the next badge to earn (if any)
  Future<VisitBadge?> getNextBadge() async {
    return await _statsManager.getNextBadge();
  }
}
