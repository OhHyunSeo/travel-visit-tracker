# Error Handling Quick Reference

Quick reference for implementing error handling in the Travel Visit Tracker app.

## Import Required Classes

```dart
import '../utils/error_handler.dart';
import '../widgets/error_retry_widget.dart';
import '../services/geojson_service.dart';
import '../services/photo_service.dart';
import '../services/location_service.dart';
import '../services/storage_service.dart';
```

## Common Patterns

### 1. GeoJSON Loading with Retry

```dart
try {
  final geoJson = await geoJsonService.loadPackWithRetry(
    countryCode,
    maxRetries: 3,
  );
  final regions = geoJsonService.parseFeatures(geoJson, countryCode);
  await storageService.saveRegions(regions);
} on GeoJSONNetworkException {
  // Try cache
  if (await geoJsonService.hasCachedPack(countryCode)) {
    final cached = await geoJsonService.getCachedPack(countryCode);
    // Use cached data
  } else {
    // Show error with retry
    ErrorHandler.showErrorDialog(
      context: context,
      title: 'Network Error',
      message: 'Unable to load region data',
      showRetry: true,
      onRetry: () => loadGeoJSON(),
    );
  }
} on GeoJSONNotFoundException {
  ErrorHandler.showErrorDialog(
    context: context,
    title: 'Region Not Available',
    message: 'This region is not supported yet',
    showRetry: false,
  );
}
```

### 2. Photo Upload with Timeout

```dart
try {
  await photoService.uploadPhoto(
    imageFile,
    regionId,
    timeoutSeconds: 30,
  );
  // Success
} on PhotoServiceException catch (e) {
  if (e.message.contains('timeout') || e.message.contains('Network')) {
    await photoService.queueOfflineUpload(imageFile, regionId);
    ErrorHandler.showErrorSnackbar(
      context,
      'Photo will upload when connection is restored',
    );
  } else if (e.message.contains('too large')) {
    ErrorHandler.showErrorSnackbar(
      context,
      'Photo is too large. Please select a smaller image.',
    );
  }
}
```

### 3. Location Permission Request

```dart
try {
  final status = await locationService.requestPermissions();
  if (status == 'denied' || status == 'restricted') {
    ErrorHandler.showSettingsDialog(
      context: context,
      title: 'Location Permission Required',
      message: 'Enable location to track visits automatically',
    );
  }
} on LocationPermissionException {
  ErrorHandler.showSettingsDialog(
    context: context,
    title: 'Permission Denied',
    message: 'Location access is required for this feature',
  );
}
```

### 4. Database Corruption Check

```dart
try {
  final isHealthy = await storageService.checkDatabaseHealth();
  if (!isHealthy) {
    final shouldRebuild = await showDialog<bool>(
      context: context,
      builder: (context) => DatabaseErrorWidget(
        onRebuild: () => Navigator.pop(context, true),
      ),
    );
    
    if (shouldRebuild == true) {
      await storageService.rebuildDatabase();
    }
  }
} on DatabaseCorruptionException {
  // Handle corruption
}
```

### 5. Region Monitoring with Limit

```dart
try {
  if (regions.length > 20) {
    regions = regions.take(20).toList();
  }
  await locationService.startMonitoring(regions);
} on RegionMonitoringLimitException {
  ErrorHandler.showErrorSnackbar(
    context,
    'Monitoring limit reached. App will manage automatically.',
  );
}
```

### 6. Ad Display with Fallback

```dart
final shown = await adService.showRewardedAd(
  onComplete: () {
    // Reward user
  },
  onAdNotAvailable: () {
    ErrorHandler.showErrorSnackbar(
      context,
      'Ad not available. Try again later.',
    );
  },
);

if (!shown) {
  // Allow user to proceed without ad
}
```

## Error Widgets

### Show Loading

```dart
return const LoadingWidget(message: 'Loading...');
```

### Show GeoJSON Error

```dart
return GeoJSONErrorWidget(
  countryCode: 'KR',
  errorMessage: error.toString(),
  onRetry: () => loadData(),
);
```

### Show Permission Error

```dart
return PermissionDeniedWidget(
  onOpenSettings: () {
    // Open settings
  },
);
```

### Show Database Error

```dart
return DatabaseErrorWidget(
  onRebuild: () async {
    await storageService.rebuildDatabase();
  },
);
```

### Show Generic Error

```dart
return ErrorRetryWidget(
  title: 'Error',
  message: 'Something went wrong',
  onRetry: () => retry(),
);
```

## Error Messages

### Show Snackbar

```dart
ErrorHandler.showErrorSnackbar(context, 'Error message');
```

### Show Dialog

```dart
await ErrorHandler.showErrorDialog(
  context: context,
  title: 'Error Title',
  message: 'Error message',
  showRetry: true,
  onRetry: () => retry(),
);
```

### Get User-Friendly Message

```dart
final message = ErrorHandler.getUserFriendlyMessage(error);
```

## Exception Types

### GeoJSON
- `GeoJSONException` - Base
- `GeoJSONNotFoundException` - 404
- `GeoJSONNetworkException` - Network
- `GeoJSONParseException` - Parse
- `GeoJSONLoadException` - General

### Location
- `LocationServiceException` - Base
- `RegionMonitoringLimitException` - Limit
- `LocationPermissionException` - Permission

### Storage
- `DatabaseCorruptionException` - Corruption

### Photo
- `PhotoServiceException` - All photo errors

## Best Practices

1. **Always catch specific exceptions first**
2. **Provide retry for recoverable errors**
3. **Use cache fallback when available**
4. **Show user-friendly messages**
5. **Allow graceful degradation**
6. **Validate before operations**
7. **Use timeouts for network calls**
8. **Implement exponential backoff**

## Timeouts

- Network requests: 30 seconds
- Photo uploads: 30 seconds
- GeoJSON downloads: 30 seconds

## Retry Delays

Exponential backoff: 1s, 2s, 4s, 8s, 16s (max)

## Region Monitoring Limit

iOS limit: 20 concurrent regions
Always enforce in app before platform call.
