# Location Service Implementation

This document describes the iOS Location Service implementation for the Travel Visit Tracker app.

## Architecture

The location service consists of three main components:

### 1. iOS Native Layer (Swift)
- **File**: `ios/Runner/LocationService.swift`
- **Purpose**: Wraps Core Location APIs and manages region monitoring
- **Key Features**:
  - CLLocationManager setup with background location updates
  - Method channel handlers for Flutter communication
  - Event channel for region enter/exit events
  - 20-slot rotation algorithm implementation

### 2. Flutter Service Layer (Dart)
- **File**: `lib/services/location_service.dart`
- **Purpose**: Provides Dart API for location functionality
- **Key Features**:
  - Method channel communication with iOS
  - Event stream for location events
  - Permission management
  - Region monitoring control

### 3. Storage Integration
- **File**: `lib/services/storage_service.dart`
- **Purpose**: Persists monitored slots and visit data
- **Key Features**:
  - Save/restore monitored region IDs
  - Track visit candidates
  - Store confirmed visits

## Key Features

### Permission Management
The service handles iOS location permissions in two stages:
1. Request "When In Use" permission first
2. Upgrade to "Always" permission for background monitoring

### 20-Slot Rotation Algorithm
iOS limits apps to monitoring 20 regions simultaneously. The rotation algorithm:
1. Calculates distance from user location to all region centroids
2. Sorts regions by distance
3. Selects the nearest 20 regions
4. Unregisters furthest regions not in top 20
5. Registers new regions in top 20
6. Only rotates if user has moved > 1000 meters

### Region Monitoring
- Uses CLCircularRegion with 500m default radius
- Notifies on both entry and exit events
- Handles monitoring failures gracefully
- Persists monitored slots to survive app restarts

## Usage Example

```dart
// Initialize the service
final locationService = LocationService();
locationService.initialize();

// Request permissions
final status = await locationService.requestPermissions();

// Add event listener
locationService.addEventListener((event) {
  if (event.isEnter) {
    print('Entered region: ${event.regionId}');
  } else if (event.isExit) {
    print('Exited region: ${event.regionId}');
  }
});

// Start monitoring regions
await locationService.startMonitoring(regions);

// Update monitored regions (20-slot rotation)
final result = await locationService.updateMonitoredRegions(allRegions);

// Restore monitored slots on app launch
final monitoredIds = await storageService.getMonitoredSlots();
await locationService.restoreMonitoredSlots(monitoredIds, allRegions);
```

## Method Channel API

### Methods
- `requestPermissions()` - Request location permissions
- `startMonitoring(regions)` - Start monitoring specific regions
- `stopMonitoring(regionIds)` - Stop monitoring specific regions
- `getMonitoringStatus()` - Get current monitoring status
- `getCurrentLocation()` - Get current user location
- `updateMonitoredRegions(allRegions)` - Update monitored regions with rotation

### Events
- `enter` - User entered a monitored region
- `exit` - User exited a monitored region
- `authorizationChanged` - Location permission status changed
- `error` - Monitoring error occurred

## Requirements Satisfied

This implementation satisfies the following requirements:

- **1.1**: Automatic visit detection with location permission
- **1.4**: Region monitoring slot management
- **1.5**: Restore monitored slots on app launch
- **7.1**: Maintain maximum of 20 active CLCircularRegion registrations
- **7.2**: Recalculate nearest 20 regions on user movement
- **7.3**: Unregister furthest regions before registering new ones
- **7.4**: Persist monitored region IDs to local storage
- **7.5**: 1000-meter movement threshold for slot rotation
- **8.1**: Onboarding screen explanation (UI layer responsibility)
- **8.2**: Request "When In Use" then "Always" permissions
- **8.4**: Background location tracking with UIBackgroundModes

## Next Steps

The Visit Manager (Task 5) will integrate with this service to:
- Create visit candidates on region enter events
- Track dwell time (300 seconds)
- Confirm visits and update map styling
- Handle region exit events
