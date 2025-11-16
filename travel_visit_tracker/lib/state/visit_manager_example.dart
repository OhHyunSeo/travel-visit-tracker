import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/location_service.dart';
import 'visit_state.dart';
import 'visit_manager.dart';

/// Example showing how to set up and use the Visit Manager
///
/// This demonstrates:
/// 1. Setting up VisitState as a provider
/// 2. Initializing VisitManager with location service
/// 3. Connecting visit confirmations to map updates
/// 4. Listening to visit state changes in UI

class VisitManagerExample extends StatefulWidget {
  const VisitManagerExample({Key? key}) : super(key: key);

  @override
  State<VisitManagerExample> createState() => _VisitManagerExampleState();
}

class _VisitManagerExampleState extends State<VisitManagerExample> {
  late VisitManager _visitManager;
  final LocationService _locationService = LocationService();

  @override
  void initState() {
    super.initState();

    // Initialize location service
    _locationService.initialize();

    // Get visit state from provider
    final visitState = context.read<VisitState>();

    // Initialize visit state
    visitState.initialize();

    // Create visit manager with callback for map updates
    _visitManager = VisitManager(
      locationService: _locationService,
      visitState: visitState,
      onVisitConfirmed: (regionId) {
        // This callback is triggered when a visit is confirmed
        // Use this to update map styling
        debugPrint('Visit confirmed for region: $regionId');

        // Example: Update map state
        // context.read<MapState>().updateRegionVisitStatus(regionId, true);
      },
    );

    // Initialize visit manager to start listening to location events
    _visitManager.initialize();
  }

  @override
  void dispose() {
    _visitManager.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Visit Manager Example'),
      ),
      body: Consumer<VisitState>(
        builder: (context, visitState, child) {
          return Column(
            children: [
              // Show active candidates
              Expanded(
                child: ListView(
                  children: [
                    const Padding(
                      padding: EdgeInsets.all(16.0),
                      child: Text(
                        'Active Visit Candidates',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    ...visitState.candidates.entries.map((entry) {
                      final candidate = entry.value;
                      final remainingSeconds =
                          300 - candidate.dwellTime.inSeconds;

                      return ListTile(
                        title: Text('Region: ${candidate.regionId}'),
                        subtitle: Text(
                          'Dwell time: ${candidate.dwellTime.inSeconds}s / 300s\n'
                          'Confirming in: ${remainingSeconds}s',
                        ),
                        trailing: candidate.isConfirmed
                            ? const Icon(Icons.check_circle,
                                color: Colors.green)
                            : CircularProgressIndicator(
                                value: candidate.dwellTime.inSeconds / 300,
                              ),
                      );
                    }).toList(),

                    const Divider(),

                    // Show confirmed visits
                    const Padding(
                      padding: EdgeInsets.all(16.0),
                      child: Text(
                        'Confirmed Visits',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    ...visitState.confirmedVisits.map((regionId) {
                      return ListTile(
                        title: Text('Region: $regionId'),
                        leading:
                            const Icon(Icons.check_circle, color: Colors.green),
                        subtitle: const Text('Visit confirmed'),
                      );
                    }).toList(),
                  ],
                ),
              ),

              // Stats
              Container(
                padding: const EdgeInsets.all(16.0),
                color: Colors.grey[200],
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    Column(
                      children: [
                        Text(
                          '${visitState.candidates.length}',
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const Text('Active Candidates'),
                      ],
                    ),
                    Column(
                      children: [
                        Text(
                          '${visitState.confirmedVisits.length}',
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const Text('Confirmed Visits'),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Example of how to set up providers in main.dart
///
/// ```dart
/// void main() {
///   runApp(
///     MultiProvider(
///       providers: [
///         ChangeNotifierProvider(create: (_) => VisitState()),
///         // Add other providers (MapState, AdState, etc.)
///       ],
///       child: const MyApp(),
///     ),
///   );
/// }
/// ```
