# Offline Sync and Network Monitoring

This document describes the offline sync and network monitoring implementation for the Travel Visit Tracker app.

## Overview

The offline sync system ensures that photo uploads and other data synchronization operations continue to work seamlessly even when the device loses network connectivity. The system automatically queues operations when offline and syncs them when connectivity is restored.

## Components

### 1. ConnectivityService

**Location**: `lib/services/connectivity_service.dart`

Monitors network connectivity status using the `connectivity_plus` plugin.

**Key Features**:
- Detects WiFi, mobile, and ethernet connections
- Provides real-time connectivity status updates via stream
- Broadcasts connectivity changes to listeners

**Usage**:
```dart
final connectivityService = ConnectivityService();
await connectivityService.initialize();

// Check current status
bool isOnline = connectivityService.isOnline;

// Listen to changes
connectivityService.statusStream.listen((isOnline) {
  print('Network status: ${isOnline ? "Online" : "Offline"}');
});
```

### 2. ConnectivityState

**Location**: `lib/state/connectivity_state.dart`

Provider-based state management for connectivity status, integrating with Flutter's widget tree.

**Usage**:
```dart
// In main.dart
ChangeNotifierProvider(
  create: (_) => ConnectivityState(connectivityService),
)

// In widgets
final isOnline = context.watch<ConnectivityState>().isOnline;
```

### 3. SyncService

**Location**: `lib/services/sync_service.dart`

Coordinates synchronization of pending uploads and other offline operations.

**Key Features**:
- Processes pending photo uploads with exponential backoff retry
- Automatically triggers sync when connectivity is restored
- Tracks last sync time
- Provides sync status updates via stream

**Usage**:
```dart
final syncService = SyncService();

// Initialize with connectivity monitoring
syncService.initialize(connectivityService);

// Manual sync trigger
await syncService.processPendingUploads();

// Get pending upload count
int pending = await syncService.getPendingUploadCount();

// Listen to sync status
syncService.syncStatusStream.listen((status) {
  switch (status) {
    case SyncStatus.syncing:
      print('Sync in progress...');
      break;
    case SyncStatus.success:
      print('Sync completed');
      break;
    case SyncStatus.error:
      print('Sync failed');
      break;
    case SyncStatus.idle:
      break;
  }
});
```

### 4. NetworkStatusIndicator

**Location**: `lib/widgets/network_status_indicator.dart`

UI widget that displays offline status in the app header.

**Features**:
- Shows red banner with "Offline" text when no connection
- Automatically hides when online
- Can be placed in AppBar or anywhere in the widget tree

**Usage**:
```dart
AppBar(
  title: Text('My App'),
  bottom: PreferredSize(
    preferredSize: Size.fromHeight(0),
    child: NetworkStatusIndicator(),
  ),
)
```

### 5. BackgroundSyncHandler

**Location**: `lib/services/background_sync_handler.dart`

Handles iOS background fetch to trigger sync operations when the app is in the background.

**Features**:
- Responds to iOS background fetch events
- Triggers sync service to process pending uploads
- Configured for 4-hour minimum fetch interval

**Usage**:
```dart
// In main.dart
final backgroundSyncHandler = BackgroundSyncHandler();
backgroundSyncHandler.initialize();
```

## Integration

### Main App Setup

```dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Initialize services
  final connectivityService = ConnectivityService();
  final syncService = SyncService();
  final backgroundSyncHandler = BackgroundSyncHandler();
  
  await connectivityService.initialize();
  syncService.initialize(connectivityService);
  await syncService.loadLastSyncTime();
  backgroundSyncHandler.initialize();
  
  // Trigger initial sync if online
  if (connectivityService.isOnline) {
    syncService.processPendingUploads();
  }
  
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (_) => ConnectivityState(connectivityService),
        ),
        // ... other providers
      ],
      child: MyApp(),
    ),
  );
}
```

### Stats Screen Integration

The Stats Screen has been updated to include:
- Manual sync button (visible when pending uploads exist and device is online)
- Sync status indicator
- Last sync timestamp
- Pending upload count badge

## iOS Configuration

### Info.plist

Background fetch capability is enabled:
```xml
<key>UIBackgroundModes</key>
<array>
  <string>location</string>
  <string>fetch</string>
</array>
```

### AppDelegate.swift

Background fetch handler is configured with 4-hour minimum interval:
```swift
application.setMinimumBackgroundFetchInterval(14400) // 4 hours
```

## Sync Triggers

The sync service is triggered in the following scenarios:

1. **App Launch**: If device is online, sync is triggered automatically
2. **Connectivity Restored**: When device regains network connection
3. **Manual Trigger**: User taps "Sync Now" button in Stats Screen
4. **Background Fetch**: iOS triggers background fetch (every ~4 hours)

## Offline Behavior

### Photo Uploads

When a user attaches a photo while offline:
1. Photo is saved to local storage
2. Photo record is created in database with `uploaded=0`
3. Thumbnail is generated and displayed immediately
4. Photo is added to pending upload queue

When connectivity is restored:
1. SyncService automatically processes pending uploads
2. Each photo is uploaded with exponential backoff retry (1s, 2s, 4s, 8s, 16s)
3. On success, photo record is updated with remote URL and `uploaded=1`
4. UI is refreshed to show sync status

### Visit Tracking

Visit tracking continues to work offline:
- Location monitoring uses device GPS (no network required)
- Visit confirmations are saved to local database
- Map rendering uses cached GeoJSON data

## Error Handling

### Network Errors

- Upload failures due to network issues trigger retry with exponential backoff
- After 5 failed attempts, upload remains in queue for next sync
- User is notified of sync failures via snackbar

### Offline State

- Manual sync button is disabled when offline
- User sees "Cannot sync while offline" message if they attempt manual sync
- Offline indicator is displayed in app header

## Testing

### Test Scenarios

1. **Offline Photo Attachment**:
   - Enable airplane mode
   - Attach photo to visited region
   - Verify photo appears in UI with local thumbnail
   - Disable airplane mode
   - Verify automatic sync occurs

2. **Manual Sync**:
   - Queue multiple photos offline
   - Go online
   - Tap "Sync Now" button
   - Verify all photos upload successfully

3. **Background Sync**:
   - Queue photos offline
   - Close app
   - Wait for background fetch (or trigger manually in Xcode)
   - Verify photos sync in background

4. **Connectivity Changes**:
   - Start online
   - Go offline (airplane mode)
   - Verify offline indicator appears
   - Go back online
   - Verify automatic sync triggers

## Performance Considerations

- Connectivity checks are lightweight and don't impact battery
- Sync operations are batched to minimize network requests
- Background fetch interval is set to 4 hours to balance freshness and battery life
- Exponential backoff prevents excessive retry attempts

## Future Enhancements

Potential improvements for future versions:
- Conflict resolution for concurrent edits
- Differential sync (only upload changes)
- Compression for large photo uploads
- Sync priority queue (urgent vs. normal)
- User-configurable sync settings
