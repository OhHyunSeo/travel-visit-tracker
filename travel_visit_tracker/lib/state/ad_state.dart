import 'package:flutter/foundation.dart';
import '../services/storage_service.dart';

/// State provider for ad-related functionality and premium features
class AdState extends ChangeNotifier {
  final StorageService _storageService;
  DateTime? _premiumUnlockedUntil;
  bool _interstitialShownThisSession = false;

  AdState(this._storageService) {
    _loadPremiumStatus();
  }

  /// Load premium unlock status from storage
  Future<void> _loadPremiumStatus() async {
    final value = await _storageService.getAppState('premium_unlocked_until');
    if (value != null) {
      try {
        _premiumUnlockedUntil = DateTime.parse(value);
        notifyListeners();
      } catch (e) {
        if (kDebugMode) {
          print('AdState: Error parsing premium unlock date: $e');
        }
      }
    }
  }

  /// Check if premium features are currently unlocked
  bool get isPremiumUnlocked {
    if (_premiumUnlockedUntil == null) return false;
    return _premiumUnlockedUntil!.isAfter(DateTime.now());
  }

  /// Get remaining premium time in hours
  int get premiumHoursRemaining {
    if (!isPremiumUnlocked) return 0;
    final difference = _premiumUnlockedUntil!.difference(DateTime.now());
    return difference.inHours;
  }

  /// Unlock premium features for 24 hours
  Future<void> unlockPremium() async {
    _premiumUnlockedUntil = DateTime.now().add(const Duration(hours: 24));
    await _storageService.setAppState(
      'premium_unlocked_until',
      _premiumUnlockedUntil!.toIso8601String(),
    );
    notifyListeners();
    if (kDebugMode) {
      print('AdState: Premium unlocked until $_premiumUnlockedUntil');
    }
  }

  /// Check if interstitial was shown this session
  bool get interstitialShownThisSession => _interstitialShownThisSession;

  /// Mark that interstitial was shown this session
  void markInterstitialShown() {
    _interstitialShownThisSession = true;
    notifyListeners();
  }

  /// Reset session flag (call on app restart)
  void resetSession() {
    _interstitialShownThisSession = false;
    notifyListeners();
  }
}
