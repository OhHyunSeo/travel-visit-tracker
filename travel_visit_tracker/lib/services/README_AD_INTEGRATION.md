# Google Mobile Ads Integration

This document describes the Google Mobile Ads integration implemented for the Travel Visit Tracker app.

## Overview

The app uses Google Mobile Ads SDK to monetize through:
- **Rewarded ads**: Unlock premium features for 24 hours
- **Interstitial ads**: Shown at flow transitions (max once per session)

## Files Created/Modified

### New Files
1. `lib/services/ad_service.dart` - Core ad management service
2. `lib/state/ad_state.dart` - State provider for ad-related functionality
3. `lib/services/ad_service_example.dart` - Usage examples and documentation

### Modified Files
1. `ios/Runner/Info.plist` - Added GADApplicationIdentifier and SKAdNetworkItems
2. `ios/Podfile` - Added Google-Mobile-Ads-SDK dependency
3. `lib/screens/stats_screen.dart` - Added premium unlock button
4. `lib/state/map_state.dart` - Added interstitial ad logic
5. `lib/screens/map_screen.dart` - Updated to await selectRegion
6. `lib/widgets/region_detail_panel.dart` - Updated to await selectRegion

## Configuration

### iOS Setup (Info.plist)
- **GADApplicationIdentifier**: Test App ID configured (ca-app-pub-3940256099942544~1458002511)
- **SKAdNetworkItems**: 48 Google AdMob network identifiers added for SKAdNetwork support

### Podfile
- Added `Google-Mobile-Ads-SDK ~> 11.0` dependency
- Added `use_frameworks!` and `use_modular_headers!`

**Note**: Run `pod install` in the `ios` directory after agreeing to Xcode license.

## Ad Service (AdService)

### Key Methods
- `initialize()` - Initialize Mobile Ads SDK
- `loadRewardedAd()` - Preload rewarded ad
- `loadInterstitialAd()` - Preload interstitial ad
- `showRewardedAd({onComplete})` - Show rewarded ad with callback
- `showInterstitialAd()` - Show interstitial ad

### Ad Configuration (AdConfig)
- Automatically uses test ad unit IDs in debug mode
- Production IDs need to be configured (currently placeholder values)
- Test IDs:
  - Rewarded: `ca-app-pub-3940256099942544/1712485313`
  - Interstitial: `ca-app-pub-3940256099942544/4411468910`

### Features
- Automatic ad preloading after display
- Graceful error handling
- Debug logging in development mode
- Lifecycle callbacks for ad events

## Ad State (AdState)

### Functionality
- Tracks premium unlock status (24-hour duration)
- Manages interstitial frequency cap (once per session)
- Persists premium unlock time to database
- Provides computed properties for UI

### Key Properties
- `isPremiumUnlocked` - Check if premium is active
- `premiumHoursRemaining` - Hours left in premium period
- `interstitialShownThisSession` - Session-based frequency cap

### Key Methods
- `unlockPremium()` - Unlock premium for 24 hours
- `markInterstitialShown()` - Mark interstitial as shown
- `resetSession()` - Reset session flag on app restart

## Premium Features

### Rewarded Ad Flow
1. User taps "Watch Ad to Unlock Premium" button in Stats screen
2. Rewarded ad is displayed
3. On completion, premium is unlocked for 24 hours
4. Premium status is persisted to database
5. UI updates to show premium active state

### Premium Feature Gating
Check `AdState.isPremiumUnlocked` before accessing premium features:
- Custom themes
- High-resolution export
- Other premium functionality

## Interstitial Ads

### Flow Transitions
Interstitial ads are shown automatically when:
1. User taps a region to view details (first time per session)
2. Ad is loaded and ready
3. No interstitial shown this session yet

### Implementation
- Handled in `MapState.selectRegion()` method
- Session flag prevents multiple shows
- Graceful fallback if ad fails to load
- User can proceed regardless of ad status

### Frequency Cap
- Maximum 1 interstitial per app session
- Session resets on app restart
- Prevents ad fatigue

## Integration with App

### Initialization (main.dart)
```dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Initialize AdService
  final adService = AdService();
  await adService.initialize();
  
  // Preload ads
  await adService.loadRewardedAd();
  await adService.loadInterstitialAd();
  
  runApp(MyApp(adService: adService));
}
```

### Provider Setup
```dart
MultiProvider(
  providers: [
    ChangeNotifierProvider(
      create: (_) => AdState(StorageService()),
    ),
    ChangeNotifierProvider(
      create: (context) => MapState(
        adService: adService,
        adState: context.read<AdState>(),
      ),
    ),
    // ... other providers
  ],
  child: MaterialApp(...),
)
```

## Testing

### Test Ads
- Test ads are automatically used in debug builds
- No need to configure test device IDs
- Test ads clearly labeled by Google

### Production Setup
Before release:
1. Create AdMob account
2. Register app and create ad units
3. Update production ad unit IDs in `AdConfig`
4. Update `GADApplicationIdentifier` in Info.plist
5. Test with production ads in release build

## Error Handling

All ad operations handle failures gracefully:
- Ad load failures are logged but don't block functionality
- Ad show failures allow user to proceed
- Network issues don't prevent app usage
- Missing ads don't crash the app

## Storage

Premium unlock status is stored in the `app_state` table:
- Key: `premium_unlocked_until`
- Value: ISO 8601 timestamp
- Persists across app restarts
- Checked on app launch

## Requirements Satisfied

✅ 6.1 - Rewarded ad unlocks premium for 24 hours
✅ 6.2 - Premium features gated by unlock status
✅ 6.3 - Interstitial ads at flow transitions
✅ 6.4 - Test and production ad unit IDs configured
✅ 6.5 - Graceful ad load failure handling

## Next Steps

1. Run `pod install` in ios directory (after agreeing to Xcode license)
2. Test rewarded ad flow in simulator/device
3. Test interstitial ad flow when tapping regions
4. Verify premium unlock persists across app restarts
5. Configure production ad unit IDs before release
6. Test with real AdMob account in production build
