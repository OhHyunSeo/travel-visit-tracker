/// Example usage of StatsManager
/// 
/// This file demonstrates how to use the StatsManager class to:
/// - Get total visited regions count
/// - Calculate visit percentages
/// - Get country breakdown
/// - Check earned badges
/// 
/// Usage in your app:
/// 
/// ```dart
/// import 'package:flutter/material.dart';
/// import 'package:provider/provider.dart';
/// import 'state/visit_state.dart';
/// import 'screens/stats_screen.dart';
/// import 'widgets/badge_notification.dart';
/// import 'services/stats_manager.dart';
/// 
/// void main() {
///   runApp(
///     MultiProvider(
///       providers: [
///         ChangeNotifierProvider(create: (_) => VisitState()),
///         // Add other providers...
///       ],
///       child: MyApp(),
///     ),
///   );
/// }
/// 
/// class MyApp extends StatelessWidget {
///   @override
///   Widget build(BuildContext context) {
///     // Set up badge notification callback
///     final visitState = Provider.of<VisitState>(context, listen: false);
///     visitState.onBadgeEarned = (badge) {
///       BadgeNotification.showSnackBar(context, badge);
///     };
/// 
///     return MaterialApp(
///       home: MainScreen(),
///     );
///   }
/// }
/// 
/// class MainScreen extends StatelessWidget {
///   @override
///   Widget build(BuildContext context) {
///     return Scaffold(
///       body: BottomNavigationBar(
///         items: [
///           BottomNavigationBarItem(icon: Icon(Icons.map), label: 'Map'),
///           BottomNavigationBarItem(icon: Icon(Icons.bar_chart), label: 'Stats'),
///         ],
///         onTap: (index) {
///           if (index == 1) {
///             Navigator.push(
///               context,
///               MaterialPageRoute(builder: (_) => StatsScreen()),
///             );
///           }
///         },
///       ),
///     );
///   }
/// }
/// 
/// // Manual stats checking example
/// Future<void> checkStats() async {
///   final statsManager = StatsManager();
///   
///   // Get total visited
///   final totalVisited = await statsManager.getTotalVisited();
///   print('Total visited: $totalVisited');
///   
///   // Get overall percentage
///   final percentage = await statsManager.getOverallPercentage();
///   print('Coverage: ${percentage.toStringAsFixed(1)}%');
///   
///   // Get country breakdown
///   final breakdown = await statsManager.getCountryBreakdown();
///   for (final stats in breakdown) {
///     print('${stats.countryCode}: ${stats.visitedCount}/${stats.totalCount}');
///   }
///   
///   // Check badges
///   final badges = await statsManager.checkBadges();
///   print('Earned badges: ${badges.map((b) => b.name).join(', ')}');
/// }
/// ```
