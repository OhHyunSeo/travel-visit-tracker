import 'package:flutter/foundation.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

/// Configuration for ad unit IDs
class AdConfig {
  static const bool useTestAds = kDebugMode;

  /// Test rewarded ad unit ID for iOS
  static const String _testRewardedAdUnitId =
      'ca-app-pub-3940256099942544/1712485313';

  /// Test interstitial ad unit ID for iOS
  static const String _testInterstitialAdUnitId =
      'ca-app-pub-3940256099942544/4411468910';

  /// Production rewarded ad unit ID (replace with actual ID)
  static const String _prodRewardedAdUnitId = 'ca-app-pub-XXXXX/YYYYY';

  /// Production interstitial ad unit ID (replace with actual ID)
  static const String _prodInterstitialAdUnitId = 'ca-app-pub-XXXXX/ZZZZZ';

  static String get rewardedAdUnitId =>
      useTestAds ? _testRewardedAdUnitId : _prodRewardedAdUnitId;

  static String get interstitialAdUnitId =>
      useTestAds ? _testInterstitialAdUnitId : _prodInterstitialAdUnitId;
}

/// Service for managing Google Mobile Ads
class AdService {
  RewardedAd? _rewardedAd;
  InterstitialAd? _interstitialAd;

  bool _isRewardedAdLoaded = false;
  bool _isInterstitialAdLoaded = false;

  /// Initialize the Mobile Ads SDK
  Future<void> initialize() async {
    await MobileAds.instance.initialize();
    if (kDebugMode) {
      print('AdService: Mobile Ads SDK initialized');
    }
  }

  /// Load a rewarded ad
  Future<void> loadRewardedAd() async {
    await RewardedAd.load(
      adUnitId: AdConfig.rewardedAdUnitId,
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (ad) {
          _rewardedAd = ad;
          _isRewardedAdLoaded = true;
          if (kDebugMode) {
            print('AdService: Rewarded ad loaded');
          }

          // Set up full screen content callback
          _rewardedAd!.fullScreenContentCallback = FullScreenContentCallback(
            onAdShowedFullScreenContent: (ad) {
              if (kDebugMode) {
                print('AdService: Rewarded ad showed full screen content');
              }
            },
            onAdDismissedFullScreenContent: (ad) {
              if (kDebugMode) {
                print('AdService: Rewarded ad dismissed');
              }
              ad.dispose();
              _rewardedAd = null;
              _isRewardedAdLoaded = false;
              // Preload next ad
              loadRewardedAd();
            },
            onAdFailedToShowFullScreenContent: (ad, error) {
              if (kDebugMode) {
                print('AdService: Rewarded ad failed to show: $error');
              }
              ad.dispose();
              _rewardedAd = null;
              _isRewardedAdLoaded = false;
            },
          );
        },
        onAdFailedToLoad: (error) {
          _isRewardedAdLoaded = false;
          if (kDebugMode) {
            print('AdService: Rewarded ad failed to load: $error');
          }
        },
      ),
    );
  }

  /// Load an interstitial ad
  Future<void> loadInterstitialAd() async {
    await InterstitialAd.load(
      adUnitId: AdConfig.interstitialAdUnitId,
      request: const AdRequest(),
      adLoadCallback: InterstitialAdLoadCallback(
        onAdLoaded: (ad) {
          _interstitialAd = ad;
          _isInterstitialAdLoaded = true;
          if (kDebugMode) {
            print('AdService: Interstitial ad loaded');
          }

          // Set up full screen content callback
          _interstitialAd!.fullScreenContentCallback =
              FullScreenContentCallback(
            onAdShowedFullScreenContent: (ad) {
              if (kDebugMode) {
                print('AdService: Interstitial ad showed full screen content');
              }
            },
            onAdDismissedFullScreenContent: (ad) {
              if (kDebugMode) {
                print('AdService: Interstitial ad dismissed');
              }
              ad.dispose();
              _interstitialAd = null;
              _isInterstitialAdLoaded = false;
              // Preload next ad
              loadInterstitialAd();
            },
            onAdFailedToShowFullScreenContent: (ad, error) {
              if (kDebugMode) {
                print('AdService: Interstitial ad failed to show: $error');
              }
              ad.dispose();
              _interstitialAd = null;
              _isInterstitialAdLoaded = false;
            },
          );
        },
        onAdFailedToLoad: (error) {
          _isInterstitialAdLoaded = false;
          if (kDebugMode) {
            print('AdService: Interstitial ad failed to load: $error');
          }
        },
      ),
    );
  }

  /// Check if rewarded ad is ready to show
  bool get isRewardedAdReady => _isRewardedAdLoaded && _rewardedAd != null;

  /// Check if interstitial ad is ready to show
  bool get isInterstitialAdReady =>
      _isInterstitialAdLoaded && _interstitialAd != null;

  /// Show rewarded ad with completion callback
  /// Returns true if ad was shown, false if not available
  Future<bool> showRewardedAd({
    required Function() onComplete,
    Function()? onAdNotAvailable,
  }) async {
    if (_rewardedAd == null) {
      if (kDebugMode) {
        print('AdService: Rewarded ad not ready');
      }
      onAdNotAvailable?.call();
      return false;
    }

    try {
      await _rewardedAd!.show(
        onUserEarnedReward: (ad, reward) {
          if (kDebugMode) {
            print(
                'AdService: User earned reward: ${reward.amount} ${reward.type}');
          }
          onComplete();
        },
      );
      return true;
    } catch (e) {
      if (kDebugMode) {
        print('AdService: Error showing rewarded ad: $e');
      }
      onAdNotAvailable?.call();
      return false;
    }
  }

  /// Show interstitial ad
  /// Returns true if ad was shown, false if not available
  Future<bool> showInterstitialAd({Function()? onAdNotAvailable}) async {
    if (_interstitialAd == null) {
      if (kDebugMode) {
        print('AdService: Interstitial ad not ready');
      }
      onAdNotAvailable?.call();
      return false;
    }

    try {
      await _interstitialAd!.show();
      return true;
    } catch (e) {
      if (kDebugMode) {
        print('AdService: Error showing interstitial ad: $e');
      }
      onAdNotAvailable?.call();
      return false;
    }
  }

  /// Preload ads for better user experience
  Future<void> preloadAds() async {
    await Future.wait([
      loadRewardedAd(),
      loadInterstitialAd(),
    ]);
  }

  /// Dispose of ads
  void dispose() {
    _rewardedAd?.dispose();
    _interstitialAd?.dispose();
  }
}
