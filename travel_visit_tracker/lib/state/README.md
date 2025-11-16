# Visit Manager and State Machine

This directory contains the visit tracking state management implementation.

## Components

### VisitState (`visit_state.dart`)

A `ChangeNotifier` provider that manages the visit lifecycle state machine.

**Key Features:**
- Tracks active visit candidates (users currently in regions)
- Manages confirmed visits (users who stayed 300+ seconds)
- Implements 300-second dwell time check with automatic confirmation
- Persists state to SQLite database via StorageService
- Handles region exit events to cancel candidates

**State Machine:**
```
[No Visit] --enter--> [Candidate] --300s dwell--> [Confirmed]
                          |
                          └--exit before 300s--> [No Visit]
```

**Main Methods:**
- `addCandidate(regionId)` - Creates a visit candidate when user enters a region
- `confirmVisit(regionId)` - Promotes candidate to confirmed visit after 300s
- `onRegionExit(regionId)` - Cancels candidate if user exits before 300s
- `cancelCandidate(regionId)` - Manually cancel a candidate
- `isVisited(regionId)` - Check if region has been visited
- `isCandidate(regionId)` - Check if region is currently a candidate

### VisitManager (`visit_manager.dart`)

Coordinates between LocationService events and VisitState.

**Key Features:**
- Listens to location service events (enter/exit/error)
- Calls appropriate VisitState methods based on events
- Provides callback for map updates when visits are confirmed
- Acts as a bridge between platform-specific location code and Flutter state

**Main Methods:**
- `initialize()` - Start listening to location events
- `dispose()` - Clean up event listeners

### Example Usage (`visit_manager_example.dart`)

Demonstrates how to:
1. Set up VisitState as a Provider
2. Initialize VisitManager with LocationService
3. Connect visit confirmations to map updates
4. Display visit candidates and confirmed visits in UI

## Integration

### Setup in main.dart

```dart
void main() {
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => VisitState()),
        // Add other providers...
      ],
      child: const MyApp(),
    ),
  );
}
```

### Initialize in App

```dart
class _MyAppState extends State<MyApp> {
  late VisitManager _visitManager;
  final LocationService _locationService = LocationService();

  @override
  void initState() {
    super.initState();
    
    _locationService.initialize();
    
    final visitState = context.read<VisitState>();
    visitState.initialize();
    
    _visitManager = VisitManager(
      locationService: _locationService,
      visitState: visitState,
      onVisitConfirmed: (regionId) {
        // Update map styling
        context.read<MapState>().updateRegionVisitStatus(regionId, true);
      },
    );
    
    _visitManager.initialize();
  }

  @override
  void dispose() {
    _visitManager.dispose();
    super.dispose();
  }
}
```

### Listen to State Changes in UI

```dart
Consumer<VisitState>(
  builder: (context, visitState, child) {
    return Column(
      children: [
        Text('Active Candidates: ${visitState.candidates.length}'),
        Text('Confirmed Visits: ${visitState.confirmedVisits.length}'),
        // Display candidates and visits...
      ],
    );
  },
)
```

## Requirements Satisfied

- **Requirement 1.2**: Automatic visit candidate creation on region enter
- **Requirement 1.3**: 300-second dwell time confirmation with state machine
- **Requirement 2.4**: Map update trigger on visit confirmation
- **Requirement 9.2**: Database persistence of candidates and visits

## Database Integration

The VisitState integrates with StorageService to:
- Save candidates to `visit_candidates` table on creation
- Update `last_update` timestamp for active candidates
- Mark regions as visited in `regions` table on confirmation
- Delete candidates from database after confirmation or cancellation

## Timer Management

Each visit candidate has an associated Timer that:
- Runs for 300 seconds from region enter time
- Automatically confirms the visit when timer completes
- Is cancelled if user exits region early
- Is restored on app restart for existing candidates
