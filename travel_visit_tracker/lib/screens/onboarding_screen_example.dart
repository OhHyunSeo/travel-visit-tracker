import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/location_service.dart';
import '../state/permission_state.dart';
import '../state/visit_state.dart';
import 'onboarding_screen.dart';
import 'map_screen.dart';

/// Example integration of OnboardingScreen with permission flow
///
/// This example demonstrates:
/// 1. Setting up PermissionState provider
/// 2. Handling permission requests
/// 3. Monitoring permission status changes
/// 4. Navigating to main app after permissions granted
/// 5. Enabling/disabling visit tracking based on permission status
class OnboardingExample extends StatefulWidget {
  const OnboardingExample({super.key});

  @override
  State<OnboardingExample> createState() => _OnboardingExampleState();
}

class _OnboardingExampleState extends State<OnboardingExample> {
  final LocationService _locationService = LocationService();
  late PermissionState _permissionState;

  @override
  void initState() {
    super.initState();
    _locationService.initialize();
    _permissionState = PermissionState(_locationService);

    // Listen to permission status changes
    _permissionState.addListener(_onPermissionStatusChanged);
  }

  @override
  void dispose() {
    _permissionState.removeListener(_onPermissionStatusChanged);
    _permissionState.dispose();
    _locationService.dispose();
    super.dispose();
  }

  /// Called when permission status changes
  /// Updates UI within 1 second of status change (Requirement 8.5)
  void _onPermissionStatusChanged() {
    if (!mounted) return;

    final permissionState = _permissionState;

    // Enable visit tracking if we have at least When In Use permission
    if (permissionState.hasWhenInUsePermission) {
      _enableVisitTracking();
    } else {
      _disableVisitTracking();
    }

    // Navigate to main app if Always permission is granted
    if (permissionState.hasAlwaysPermission) {
      _navigateToMainApp();
    }
  }

  void _enableVisitTracking() {
    // Enable visit tracking in VisitState
    final visitState = context.read<VisitState>();
    visitState.enableTracking();

    debugPrint('Visit tracking enabled');
  }

  void _disableVisitTracking() {
    // Disable visit tracking in VisitState
    final visitState = context.read<VisitState>();
    visitState.disableTracking();

    debugPrint('Visit tracking disabled');
  }

  void _navigateToMainApp() {
    if (!mounted) return;

    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (context) => const MapScreen(),
      ),
    );
  }

  Future<void> _handleEnableLocation() async {
    await _permissionState.requestPermissions(context);

    // Show denial rationale if permission was denied
    if (_permissionState.isDenied) {
      await _permissionState.showDenialRationale(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<PermissionState>.value(
      value: _permissionState,
      child: OnboardingScreen(
        onEnableLocation: _handleEnableLocation,
      ),
    );
  }
}

/// Example of how to check permission status in other parts of the app
class PermissionStatusExample extends StatelessWidget {
  const PermissionStatusExample({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<PermissionState>(
      builder: (context, permissionState, child) {
        return Column(
          children: [
            // Show current permission status
            Text('Permission Status: ${permissionState.status}'),

            // Show different UI based on permission
            if (permissionState.hasAlwaysPermission)
              const Text('✓ Full background tracking enabled')
            else if (permissionState.hasWhenInUsePermission)
              const Text('⚠ Limited tracking (only when app is open)')
            else if (permissionState.isDenied)
              const Text('✗ Location access denied')
            else
              const Text('? Permission not determined'),

            // Show error message if any
            if (permissionState.errorMessage != null)
              Text(
                'Error: ${permissionState.errorMessage}',
                style: const TextStyle(color: Colors.red),
              ),

            // Show settings button if denied
            if (permissionState.isDenied)
              ElevatedButton(
                onPressed: () => permissionState.openAppSettings(),
                child: const Text('Open Settings'),
              ),
          ],
        );
      },
    );
  }
}

/// Example of monitoring permission changes in a service
class PermissionMonitoringExample {
  final PermissionState _permissionState;

  PermissionMonitoringExample(LocationService locationService)
      : _permissionState = PermissionState(locationService) {
    _setupPermissionMonitoring();
  }

  void _setupPermissionMonitoring() {
    // The PermissionState automatically listens to authorization changes
    // from LocationService via the event stream
    _permissionState.addListener(_onPermissionChanged);
  }

  void _onPermissionChanged() {
    final status = _permissionState.status;

    switch (status) {
      case PermissionStatus.authorizedAlways:
        debugPrint('Always permission granted - enabling full tracking');
        // Enable background monitoring
        break;
      case PermissionStatus.authorizedWhenInUse:
        debugPrint(
            'When In Use permission granted - enabling foreground tracking');
        // Enable foreground-only monitoring
        break;
      case PermissionStatus.denied:
      case PermissionStatus.restricted:
        debugPrint('Permission denied - disabling tracking');
        // Disable all tracking
        break;
      case PermissionStatus.notDetermined:
        debugPrint('Permission not determined - waiting for user decision');
        break;
      case PermissionStatus.unknown:
        debugPrint('Unknown permission status');
        break;
    }
  }

  void dispose() {
    _permissionState.removeListener(_onPermissionChanged);
    _permissionState.dispose();
  }
}
