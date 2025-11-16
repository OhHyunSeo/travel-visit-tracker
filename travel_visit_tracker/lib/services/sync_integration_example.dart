// Example of how to integrate connectivity monitoring and sync service in main.dart

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'connectivity_service.dart';
import 'sync_service.dart';
import 'background_sync_handler.dart';
import '../state/connectivity_state.dart';

/// Example main function showing integration
void exampleMain() {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize services
  final connectivityService = ConnectivityService();
  final syncService = SyncService();
  final backgroundSyncHandler = BackgroundSyncHandler();

  // Initialize connectivity monitoring
  connectivityService.initialize();

  // Initialize sync service with connectivity monitoring
  syncService.initialize(connectivityService);

  // Load last sync time
  syncService.loadLastSyncTime();

  // Initialize background sync handler for iOS
  backgroundSyncHandler.initialize();

  // Trigger initial sync if online
  connectivityService.statusStream.first.then((isOnline) {
    if (isOnline) {
      syncService.processPendingUploads();
    }
  });

  runApp(
    MultiProvider(
      providers: [
        // Add ConnectivityState provider
        ChangeNotifierProvider(
          create: (_) => ConnectivityState(connectivityService),
        ),
        // ... other providers
      ],
      child: const MyApp(),
    ),
  );
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Travel Visit Tracker',
      home: Scaffold(
        appBar: AppBar(
          title: const Text('Travel Visit Tracker'),
          // Add network status indicator to app bar
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(0),
            child: Consumer<ConnectivityState>(
              builder: (context, connectivityState, child) {
                if (!connectivityState.isOnline) {
                  return Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    color: Colors.red.shade700,
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.cloud_off, size: 16, color: Colors.white),
                        SizedBox(width: 6),
                        Text(
                          'Offline',
                          style: TextStyle(color: Colors.white, fontSize: 12),
                        ),
                      ],
                    ),
                  );
                }
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
        body: const Center(
          child: Text('App Content'),
        ),
      ),
    );
  }
}

/// Example of triggering sync on app launch
class AppInitializer {
  static Future<void> initialize() async {
    final syncService = SyncService();
    final connectivityService = ConnectivityService();

    // Initialize connectivity
    await connectivityService.initialize();

    // Initialize sync with connectivity monitoring
    syncService.initialize(connectivityService);

    // Load last sync time
    await syncService.loadLastSyncTime();

    // Trigger sync if online
    if (connectivityService.isOnline) {
      await syncService.processPendingUploads();
    }
  }
}

/// Example of manual sync trigger
class ManualSyncExample extends StatelessWidget {
  const ManualSyncExample({super.key});

  @override
  Widget build(BuildContext context) {
    final connectivityState = context.watch<ConnectivityState>();
    final syncService = SyncService();

    return ElevatedButton(
      onPressed: connectivityState.isOnline
          ? () async {
              await syncService.processPendingUploads();
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Sync completed')),
                );
              }
            }
          : null,
      child: const Text('Sync Now'),
    );
  }
}
