import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'screens/map_screen.dart';
import 'screens/stats_screen.dart';
import 'screens/onboarding_screen.dart';
import 'state/map_state.dart';
import 'state/visit_state.dart';
import 'state/ad_state.dart';
import 'state/connectivity_state.dart';
import 'state/permission_state.dart';
import 'state/badge_state.dart';
import 'services/storage_service.dart';
import 'services/ad_service.dart';
import 'services/connectivity_service.dart';
import 'services/location_service.dart';
import 'services/geojson_service.dart';
import 'services/event_coordinator.dart';
import 'widgets/network_status_indicator.dart';
import 'widgets/badge_notification.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize AdService
  final adService = AdService();
  await adService.initialize();

  // Preload ads
  await adService.loadRewardedAd();
  await adService.loadInterstitialAd();

  // Initialize Storage Service (creates database)
  final storageService = StorageService();
  await storageService.database;

  runApp(MyApp(
    adService: adService,
    storageService: storageService,
  ));
}

class MyApp extends StatelessWidget {
  final AdService adService;
  final StorageService storageService;

  const MyApp({
    super.key,
    required this.adService,
    required this.storageService,
  });

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (_) => AdState(storageService),
        ),
        ChangeNotifierProvider(
          create: (_) => ConnectivityState(ConnectivityService()),
        ),
        ChangeNotifierProvider(
          create: (context) => MapState(
            adService: adService,
            adState: context.read<AdState>(),
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => VisitState(),
        ),
        ChangeNotifierProvider(
          create: (_) => PermissionState(LocationService()),
        ),
        ChangeNotifierProvider(
          create: (_) => BadgeState(),
        ),
      ],
      child: MaterialApp(
        title: 'Travel Visit Tracker',
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: Colors.green),
          useMaterial3: true,
        ),
        home: const AppInitializer(),
      ),
    );
  }
}

/// Widget that handles app initialization and determines initial route
class AppInitializer extends StatefulWidget {
  const AppInitializer({super.key});

  @override
  State<AppInitializer> createState() => _AppInitializerState();
}

class _AppInitializerState extends State<AppInitializer> {
  bool _isInitializing = true;
  bool _needsOnboarding = false;
  EventCoordinator? _eventCoordinator;

  @override
  void initState() {
    super.initState();
    _initializeApp();
  }

  @override
  void dispose() {
    _eventCoordinator?.dispose();
    super.dispose();
  }

  Future<void> _initializeApp() async {
    try {
      final storageService = StorageService();
      final locationService = LocationService();
      final geoJsonService = GeoJSONService();

      // Initialize location service
      locationService.initialize();

      // Check if onboarding is needed
      final hasCompletedOnboarding =
          await storageService.getAppState('onboarding_completed');
      _needsOnboarding = hasCompletedOnboarding != 'true';

      if (!_needsOnboarding && mounted) {
        // Initialize VisitState
        final visitState = context.read<VisitState>();
        await visitState.initialize();

        // Set up badge notification callback
        final badgeState = context.read<BadgeState>();
        await badgeState.initialize();

        visitState.onBadgeEarned = (badge) {
          // Show notification in UI
          if (mounted) {
            BadgeNotification.show(context, badge);
          }
        };

        // Initialize EventCoordinator to wire up all event flows
        final mapState = context.read<MapState>();
        _eventCoordinator = EventCoordinator(
          locationService: locationService,
          visitState: visitState,
          mapState: mapState,
          storageService: storageService,
        );
        _eventCoordinator!.initialize();

        // Restore monitored slots from storage
        final monitoredSlots = await storageService.getMonitoredSlots();
        if (monitoredSlots.isNotEmpty) {
          final allRegions = await storageService.getAllRegions();
          await locationService.restoreMonitoredSlots(
              monitoredSlots, allRegions);
        }

        // Load cached GeoJSON packs
        final cachedCountries = ['KR']; // Default to KR for now
        for (final countryCode in cachedCountries) {
          try {
            await geoJsonService.getCachedPack(countryCode);
            if (mounted) {
              await mapState.loadRegions(countryCode);
            }
          } catch (e) {
            debugPrint('Error loading cached pack for $countryCode: $e');
          }
        }

        // Check permission status and enable tracking if granted
        try {
          final status = await locationService.getMonitoringStatus();
          final authStatus = status['authorizationStatus'] as String?;

          if (authStatus == 'authorizedAlways' ||
              authStatus == 'authorizedWhenInUse') {
            if (mounted) {
              visitState.enableTracking();
            }
          }
        } catch (e) {
          debugPrint('Error checking location permission: $e');
        }
      }

      setState(() {
        _isInitializing = false;
      });
    } catch (e) {
      debugPrint('Error during app initialization: $e');
      setState(() {
        _isInitializing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isInitializing) {
      return const Scaffold(
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('Initializing...'),
            ],
          ),
        ),
      );
    }

    if (_needsOnboarding) {
      return OnboardingScreen(
        onEnableLocation: () async {
          // Mark onboarding as completed
          final storageService = StorageService();
          await storageService.setAppState('onboarding_completed', 'true');

          // Reinitialize the app
          setState(() {
            _isInitializing = true;
            _needsOnboarding = false;
          });
          await _initializeApp();
        },
      );
    }

    return const MainNavigationScreen();
  }
}

class MainNavigationScreen extends StatefulWidget {
  const MainNavigationScreen({super.key});

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  int _currentIndex = 0;

  final List<Widget> _screens = const [
    MapScreen(),
    StatsScreen(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          IndexedStack(
            index: _currentIndex,
            children: _screens,
          ),
          // Network status indicator at the top
          const Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: NetworkStatusIndicator(),
          ),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) {
          setState(() {
            _currentIndex = index;
          });
        },
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.map),
            label: 'Map',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.bar_chart),
            label: 'Stats',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.settings),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
      ),
      body: ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.info),
            title: const Text('About'),
            subtitle: const Text('Travel Visit Tracker v1.0.0'),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.location_on),
            title: const Text('Location Permissions'),
            subtitle: const Text('Manage location access'),
            onTap: () {
              // TODO: Navigate to permission settings
            },
          ),
          ListTile(
            leading: const Icon(Icons.storage),
            title: const Text('Storage'),
            subtitle: const Text('Manage cached data'),
            onTap: () {
              // TODO: Show storage management options
            },
          ),
        ],
      ),
    );
  }
}
