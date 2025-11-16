# Error Handling Implementation Guide

This document describes the comprehensive error handling implementation across the Travel Visit Tracker app.

## Overview

The app implements robust error handling for all critical operations:
- GeoJSON loading with retry and cache fallback
- Photo uploads with timeout and offline queueing
- Location permission management with settings navigation
- Database corruption detection and rebuild
- Region monitoring limit handling
- Ad load failures with graceful degradation

## Error Categories

### 1. Network Errors

**Scenarios:**
- No internet connection
- Server unreachable
- Request timeout

**Handling:**
- Automatic fallback to cached data (GeoJSON)
- Offline queueing (photo uploads)
- Retry with exponential backoff
- User-friendly error messages

**Example:**
```dart
try {
  final geoJson = await geoJsonService.loadPackWithRetry(
    'KR',
    maxRetries: 3,
  );
} on GeoJSONNetworkException catch (e) {
  // Try cache fallback
  if (await geoJsonService.hasCachedPack('KR')) {
    final cached = await geoJsonService.getCachedPack('KR');
    // Use cached data
  } else {
    // Show error with retry button
    ErrorHandler.showErrorDialog(
      context: context,
      title: 'Network Error',
      message: 'Unable to load region data',
      showRetry: true,
      onRetry: () => loadGeoJSON(),
    );
  }
}
```

### 2. Location Permission Errors

**Scenarios:**
- Permission denied by user
- Permission restricted (parental controls)
- Permission not determined

**Handling:**
- Clear explanation of why permission is needed
- Direct link to app settings
- Graceful degradation (disable auto-tracking)

**Example:**
```dart
try {
  await locationService.requestPermissions();
} on LocationPermissionException catch (e) {
  ErrorHandler.showSettingsDialog(
    context: context,
    title: 'Location Permission Required',
    message: 'Enable location access to track visits automatically',
  );
}
```

### 3. Database Corruption

**Scenarios:**
- SQLite database corrupted
- Integrity check fails
- Query errors

**Handling:**
- Automatic detection on app start
- User confirmation before rebuild
- Preserve critical data if possible
- Re-download region data after rebuild

**Example:**
```dart
try {
  final isHealthy = await storageService.checkDatabaseHealth();
  if (!isHealthy) {
    // Show rebuild dialog
    showDialog(
      context: context,
      builder: (context) => DatabaseErrorWidget(
        onRebuild: () async {
          await storageService.rebuildDatabase();
          // Re-download data
        },
      ),
    );
  }
} on DatabaseCorruptionException catch (e) {
  // Handle corruption
}
```

### 4. Region Monitoring Limit

**Scenarios:**
- iOS 20-region limit exceeded
- Platform monitoring failure

**Handling:**
- Enforce limit in app logic (prevent errors)
- Automatic slot rotation
- Informative message to user
- Continue operation with available slots

**Example:**
```dart
try {
  await locationService.startMonitoring(regions);
} on RegionMonitoringLimitException catch (e) {
  // Inform user, but continue
  ErrorHandler.showErrorSnackbar(
    context,
    'Monitoring limit reached. App will manage regions automatically.',
  );
}
```

### 5. Photo Upload Errors

**Scenarios:**
- Network timeout (30 seconds)
- File too large (>10 MB)
- Invalid file format
- Server error

**Handling:**
- 30-second timeout enforcement
- File size validation before upload
- Automatic offline queueing
- Exponential backoff retry (1s, 2s, 4s, 8s, 16s)

**Example:**
```dart
try {
  await photoService.uploadPhoto(
    imageFile,
    regionId,
    timeoutSeconds: 30,
  );
} on PhotoServiceException catch (e) {
  if (e.message.contains('timeout')) {
    // Queue for later
    await photoService.queueOfflineUpload(imageFile, regionId);
    showSnackbar('Photo will upload when connection is restored');
  } else if (e.message.contains('too large')) {
    showSnackbar('Photo is too large. Please select a smaller image.');
  }
}
```

### 6. Ad Load Failures

**Scenarios:**
- Ad not loaded yet
- Ad load error
- No ad inventory

**Handling:**
- Allow user to proceed without ad
- Preload ads for better availability
- Graceful degradation (no blocking)
- Retry on next opportunity

**Example:**
```dart
final adShown = await adService.showRewardedAd(
  onComplete: () => unlockPremium(),
  onAdNotAvailable: () {
    showSnackbar('Ad not available. Try again later.');
  },
);

if (!adShown) {
  // Allow user to continue without reward
  showDialog(
    context: context,
    builder: (context) => AlertDialog(
      title: Text('Ad Not Available'),
      content: Text('Continue without watching ad?'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text('Continue'),
        ),
      ],
    ),
  );
}
```

## Custom Exception Classes

### GeoJSON Exceptions
- `GeoJSONException` - Base exception
- `GeoJSONNotFoundException` - 404 errors
- `GeoJSONNetworkException` - Network failures
- `GeoJSONParseException` - Parse errors
- `GeoJSONLoadException` - General load failures

### Location Exceptions
- `LocationServiceException` - Base exception
- `RegionMonitoringLimitException` - 20-region limit
- `LocationPermissionException` - Permission issues

### Storage Exceptions
- `DatabaseCorruptionException` - Database corruption

### Photo Exceptions
- `PhotoServiceException` - All photo-related errors

## Error Handler Utility

The `ErrorHandler` class provides centralized error handling:

```dart
// Show error dialog with retry
ErrorHandler.showErrorDialog(
  context: context,
  title: 'Error Title',
  message: 'Error message',
  showRetry: true,
  onRetry: () => retryOperation(),
);

// Show error snackbar
ErrorHandler.showErrorSnackbar(context, 'Error message');

// Show settings dialog
ErrorHandler.showSettingsDialog(
  context: context,
  title: 'Permission Required',
  message: 'Enable permission in Settings',
);

// Get user-friendly message
final message = ErrorHandler.getUserFriendlyMessage(error);

// Check if error is recoverable
if (ErrorHandler.isRecoverableError(error)) {
  // Retry logic
}
```

## Error Widgets

### ErrorRetryWidget
Generic error display with retry button.

### GeoJSONErrorWidget
Specialized for GeoJSON load errors with context-aware messages.

### DatabaseErrorWidget
Database corruption with rebuild option.

### PermissionDeniedWidget
Permission errors with settings navigation.

### LoadingWidget
Loading state with message.

## Best Practices

1. **Always catch specific exceptions first**
   ```dart
   try {
     // operation
   } on SpecificException catch (e) {
     // handle specific
   } catch (e) {
     // handle generic
   }
   ```

2. **Provide retry mechanisms for recoverable errors**
   - Network errors
   - Timeout errors
   - Temporary server issues

3. **Use graceful degradation**
   - Cache fallback for offline
   - Continue without ads if unavailable
   - Disable features if permission denied

4. **Show user-friendly messages**
   - Avoid technical jargon
   - Explain what happened
   - Provide clear next steps

5. **Log errors for debugging**
   - Use `debugPrint` in development
   - Consider crash reporting in production

6. **Validate input before operations**
   - File size before upload
   - Region count before monitoring
   - Permission status before location access

7. **Implement timeouts**
   - Network requests: 30 seconds
   - Photo uploads: 30 seconds
   - GeoJSON downloads: 30 seconds

8. **Use exponential backoff for retries**
   - 1s, 2s, 4s, 8s, 16s max
   - Prevents server overload
   - Better user experience

## Testing Error Scenarios

### Network Errors
- Enable airplane mode
- Use network throttling
- Disconnect WiFi during operation

### Permission Errors
- Deny permissions in Settings
- Test restricted mode (parental controls)
- Test permission changes while app running

### Database Errors
- Corrupt database file manually
- Test with full storage
- Test concurrent access

### Timeout Errors
- Use slow network connection
- Test with large files
- Simulate server delays

### Ad Errors
- Test with no ad inventory
- Test with ad blockers
- Test rapid ad requests

## Monitoring and Analytics

Consider tracking:
- Error frequency by type
- Retry success rates
- Cache hit rates
- Permission denial rates
- Ad load failure rates

This helps identify patterns and improve error handling over time.
