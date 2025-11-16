# Permission Request Flow and Onboarding

This document describes the implementation of the permission request flow and onboarding screen for the Travel Visit Tracker app.

## Overview

The permission flow follows iOS best practices by:
1. Showing an onboarding screen explaining why location access is needed
2. Requesting "When In Use" permission first
3. Upgrading to "Always" permission after "When In Use" is granted
4. Handling permission denial gracefully with settings navigation
5. Monitoring permission status changes in real-time

## Components

### 1. OnboardingScreen Widget

**Location**: `lib/screens/onboarding_screen.dart`

A full-screen onboarding widget that:
- Displays app benefits with icons and descriptions
- Shows an "Enable Location" button
- Adapts UI based on permission status (shows "Open Settings" if denied)
- Displays loading state while requesting permissions
- Shows warning banner when permission is denied

**Usage**:
```dart
OnboardingScreen(
  onEnableLocation: () async {
    await permissionState.requestPermissions(context);
  },
)
```

### 2. PermissionState Provider

**Location**: `lib/state/permission_state.dart`

A ChangeNotifier that manages permission status and requests:

**Key Properties**:
- `status`: Current permission status (notDetermined, denied, authorizedWhenInUse, authorizedAlways, etc.)
- `isRequestingPermission`: Whether a permission request is in progress
- `errorMessage`: Any error that occurred during permission request
- `hasWhenInUsePermission`: Whether user has at least "When In Use" permission
- `hasAlwaysPermission`: Whether user has "Always" permission
- `isDenied`: Whether permission was denied or restricted

**Key Methods**:
- `requestPermissions(BuildContext)`: Initiates the permission request sequence
- `showDenialRationale(BuildContext)`: Shows dialog explaining why permission is needed with "Open Settings" button
- `openAppSettings()`: Opens iOS Settings app for the user to manually enable permissions

**Permission Request Sequence**:
1. Call `requestPermissions(context)`
2. If status is `notDetermined`, request "When In Use" permission
3. If "When In Use" is granted, show dialog explaining "Always" permission benefits
4. If user accepts, request "Always" permission
5. If denied at any point, show denial rationale with settings navigation

### 3. LocationService Integration

**Location**: `lib/services/location_service.dart`

The LocationService sends authorization change events via EventChannel:
```dart
{
  "type": "authorizationChanged",
  "status": "authorizedAlways" // or "authorizedWhenInUse", "denied", etc.
}
```

PermissionState listens to these events and updates its status automatically, ensuring UI updates within 1 second of any permission change.

## Integration Example

### Setup in main.dart

```dart
void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    final locationService = LocationService();
    locationService.initialize();

    return MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (_) => PermissionState(locationService),
        ),
        ChangeNotifierProvider(
          create: (_) => VisitState(),
        ),
        // ... other providers
      ],
      child: MaterialApp(
        home: const OnboardingWrapper(),
      ),
    );
  }
}
```

### OnboardingWrapper

```dart
class OnboardingWrapper extends StatefulWidget {
  const OnboardingWrapper({super.key});

  @override
  State<OnboardingWrapper> createState() => _OnboardingWrapperState();
}

class _OnboardingWrapperState extends State<OnboardingWrapper> {
  @override
  void initState() {
    super.initState();
    // Listen to permission changes
    context.read<PermissionState>().addListener(_onPermissionChanged);
  }

  @override
  void dispose() {
    context.read<PermissionState>().removeListener(_onPermissionChanged);
    super.dispose();
  }

  void _onPermissionChanged() {
    final permissionState = context.read<PermissionState>();
    final visitState = context.read<VisitState>();

    // Enable/disable tracking based on permission
    if (permissionState.hasWhenInUsePermission) {
      visitState.enableTracking();
    } else {
      visitState.disableTracking();
    }

    // Navigate to main app if Always permission granted
    if (permissionState.hasAlwaysPermission) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const MapScreen()),
      );
    }
  }

  Future<void> _handleEnableLocation() async {
    final permissionState = context.read<PermissionState>();
    await permissionState.requestPermissions(context);

    // Show denial rationale if needed
    if (permissionState.isDenied) {
      await permissionState.showDenialRationale(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    return OnboardingScreen(
      onEnableLocation: _handleEnableLocation,
    );
  }
}
```

## Permission Status Monitoring

The PermissionState automatically monitors permission changes through the LocationService event stream. When the iOS system sends an authorization change event (e.g., user changes permission in Settings), the PermissionState updates within 1 second and notifies all listeners.

### Monitoring in Other Parts of the App

```dart
// In any widget
Consumer<PermissionState>(
  builder: (context, permissionState, child) {
    if (permissionState.isDenied) {
      return Column(
        children: [
          const Text('Location access is disabled'),
          ElevatedButton(
            onPressed: () => permissionState.openAppSettings(),
            child: const Text('Open Settings'),
          ),
        ],
      );
    }

    if (permissionState.hasAlwaysPermission) {
      return const Text('Full background tracking enabled');
    }

    return const Text('Limited tracking (foreground only)');
  },
)
```

## iOS Configuration

Ensure the following keys are in `ios/Runner/Info.plist`:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>We need your location to automatically detect when you visit new regions and color them on your map.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Allow background location access to track visits even when the app is closed, so you never miss a region.</string>

<key>UIBackgroundModes</key>
<array>
  <string>location</string>
</array>
```

## Dependencies

Add to `pubspec.yaml`:
```yaml
dependencies:
  url_launcher: ^6.2.2  # For opening Settings app
  provider: ^6.1.1      # For state management
```

## Requirements Mapping

- **Requirement 8.1**: OnboardingScreen displays explanation before requesting permissions
- **Requirement 8.2**: Requests "When In Use" first, then "Always" with proper messaging
- **Requirement 8.3**: Shows denial rationale with "Open Settings" button
- **Requirement 8.4**: Shows dialog explaining background tracking benefits before requesting "Always"
- **Requirement 8.5**: PermissionState listens to authorization changes and updates UI within 1 second

## Testing

### Manual Testing Scenarios

1. **First Launch**:
   - Launch app → See onboarding screen
   - Tap "Enable Location" → See iOS "When In Use" permission dialog
   - Grant permission → See "Always" permission rationale dialog
   - Accept → See iOS "Always" permission dialog
   - Grant → Navigate to main app

2. **Permission Denial**:
   - Deny "When In Use" → See warning banner and "Open Settings" button
   - Tap "Open Settings" → iOS Settings app opens

3. **Permission Change**:
   - Grant permission in app
   - Go to iOS Settings → Change permission to "Never"
   - Return to app → UI updates within 1 second showing denied state

4. **Partial Permission**:
   - Grant "When In Use" only
   - Decline "Always" upgrade
   - App should work with limited functionality (foreground tracking only)

### Unit Testing

See `test/permission_state_test.dart` for unit tests covering:
- Permission status parsing
- Request sequence logic
- Event handling
- State transitions
