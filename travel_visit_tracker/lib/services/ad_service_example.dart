/// Example usage of AdService
///
/// This file demonstrates how to initialize and use the AdService
/// in the Travel Visit Tracker app.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'ad_service.dart';
import '../state/ad_state.dart';
import 'storage_service.dart';

/// Example of initializing AdService in main.dart
///
/// ```dart
/// void main() async {
///   WidgetsFlutterBinding.ensureInitialized();
///   
///   // Initialize AdService
///   final adService = AdService();
///   await adService.initialize();
///   
///   // Preload ads
///   await adService.loadRewardedAd();
///   await adService.loadInterstitialAd();
///   
///   runApp(MyApp(adService: adService));
/// }
/// ```

/// Example of setting up providers with AdState
///
/// ```dart
/// class MyApp extends StatelessWidget {
///   final AdService adService;
///   
///   const MyApp({required this.adService, Key? key}) : super(key: key);
///   
///   @override
///   Widget build(BuildContext context) {
///     return MultiProvider(
///       providers: [
///         ChangeNotifierProvider(
///           create: (_) => AdState(StorageService()),
///         ),
///         ChangeNotifierProvider(
///           create: (context) => MapState(
///             adService: adService,
///             adState: context.read<AdState>(),
///           ),
///         ),
///         // ... other providers
///       ],
///       child: MaterialApp(
///         title: 'Travel Visit Tracker',
///         home: const HomeScreen(),
///       ),
///     );
///   }
/// }
/// ```

/// Example of using rewarded ads for premium unlock
///
/// ```dart
/// class PremiumButton extends StatelessWidget {
///   final AdService adService;
///   
///   const PremiumButton({required this.adService, Key? key}) : super(key: key);
///   
///   @override
///   Widget build(BuildContext context) {
///     final adState = context.watch<AdState>();
///     
///     if (adState.isPremiumUnlocked) {
///       return Text('Premium active for ${adState.premiumHoursRemaining}h');
///     }
///     
///     return ElevatedButton(
///       onPressed: adService.isRewardedAdReady ? () async {
///         await adService.showRewardedAd(
///           onComplete: () async {
///             await context.read<AdState>().unlockPremium();
///             ScaffoldMessenger.of(context).showSnackBar(
///               const SnackBar(content: Text('Premium unlocked!')),
///             );
///           },
///         );
///       } : null,
///       child: const Text('Watch Ad to Unlock Premium'),
///     );
///   }
/// }
/// ```

/// Example of checking premium status before accessing features
///
/// ```dart
/// void exportHighResolution(BuildContext context) {
///   final adState = context.read<AdState>();
///   
///   if (!adState.isPremiumUnlocked) {
///     showDialog(
///       context: context,
///       builder: (context) => AlertDialog(
///         title: const Text('Premium Feature'),
///         content: const Text('Watch an ad to unlock premium features'),
///         actions: [
///           TextButton(
///             onPressed: () => Navigator.pop(context),
///             child: const Text('Cancel'),
///           ),
///           TextButton(
///             onPressed: () {
///               Navigator.pop(context);
///               // Show rewarded ad
///             },
///             child: const Text('Watch Ad'),
///           ),
///         ],
///       ),
///     );
///     return;
///   }
///   
///   // Proceed with high-resolution export
///   _performExport();
/// }
/// ```

/// Example of interstitial ad flow (handled automatically by MapState)
///
/// The interstitial ad is shown automatically when:
/// 1. User taps on a region to view details (first time per session)
/// 2. The ad is loaded and ready
/// 3. No interstitial has been shown this session yet
///
/// This is handled in MapState.selectRegion() method.
/// The session flag is reset when the app restarts.

/// Example of handling ad load failures gracefully
///
/// ```dart
/// void showFeatureWithAd(BuildContext context) async {
///   final adService = AdService();
///   
///   // Try to show interstitial
///   if (adService.isInterstitialAdReady) {
///     try {
///       await adService.showInterstitialAd();
///     } catch (e) {
///       print('Ad failed to show: $e');
///       // Continue anyway - don't block user
///     }
///   }
///   
///   // Show the feature regardless of ad success
///   Navigator.push(
///     context,
///     MaterialPageRoute(builder: (_) => const FeatureScreen()),
///   );
/// }
/// ```

/// Ad configuration notes:
///
/// - Test ads are used automatically in debug mode (kDebugMode)
/// - Production ad unit IDs should be configured in AdConfig class
/// - Rewarded ads unlock premium for 24 hours
/// - Interstitial ads have a frequency cap of 1 per session
/// - Ads are preloaded after being shown for better UX
/// - All ad operations handle failures gracefully
