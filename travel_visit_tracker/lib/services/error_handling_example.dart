import 'dart:io';
import 'package:flutter/material.dart';
import 'geojson_service.dart';
import 'photo_service.dart';
import 'location_service.dart';
import 'storage_service.dart';
import 'ad_service.dart';
import '../utils/error_handler.dart';
import '../widgets/error_retry_widget.dart';

/// Example of comprehensive error handling in the app
class ErrorHandlingExample {
  final GeoJSONService _geoJsonService = GeoJSONService();
  final PhotoService _photoService = PhotoService();
  final LocationService _locationService = LocationService();
  final StorageService _storageService = StorageService();
  final AdService _adService = AdService();

  /// Example: Load GeoJSON with error handling and retry
  Future<void> loadGeoJSONWithErrorHandling(
    BuildContext context,
    String countryCode,
  ) async {
    try {
      // Attempt to load with retry logic
      final geoJsonString = await _geoJsonService.loadPackWithRetry(
        countryCode,
        maxRetries: 3,
      );

      // Parse features
      final regions = _geoJsonService.parseFeatures(geoJsonString, countryCode);

      // Save to database
      await _storageService.saveRegions(regions);

      // Success - show confirmation
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Loaded ${regions.length} regions for $countryCode'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } on GeoJSONNetworkException catch (e) {
      // Network error - try to use cache
      if (context.mounted) {
        final hasCached = await _geoJsonService.hasCachedPack(countryCode);
        if (hasCached) {
          ErrorHandler.showErrorSnackbar(
            context,
            'Using cached data. Unable to update: ${e.message}',
          );
          // Load from cache
          final cachedData = await _geoJsonService.getCachedPack(countryCode);
          final regions =
              _geoJsonService.parseFeatures(cachedData, countryCode);
          await _storageService.saveRegions(regions);
        } else {
          // No cache available - show error with retry
          await ErrorHandler.showErrorDialog(
            context: context,
            title: 'Network Error',
            message: ErrorHandler.handleGeoJSONError(e),
            showRetry: true,
            onRetry: () => loadGeoJSONWithErrorHandling(context, countryCode),
          );
        }
      }
    } on GeoJSONNotFoundException {
      // Region not found
      if (context.mounted) {
        await ErrorHandler.showErrorDialog(
          context: context,
          title: 'Region Not Available',
          message: 'Region data for $countryCode is not available yet.',
          showRetry: false,
        );
      }
    } on GeoJSONParseException {
      // Parse error
      if (context.mounted) {
        await ErrorHandler.showErrorDialog(
          context: context,
          title: 'Data Error',
          message: 'Failed to parse region data. Please try again later.',
          showRetry: true,
          onRetry: () => loadGeoJSONWithErrorHandling(context, countryCode),
        );
      }
    } catch (e) {
      // Generic error
      if (context.mounted) {
        ErrorHandler.showErrorSnackbar(
          context,
          ErrorHandler.getUserFriendlyMessage(e),
        );
      }
    }
  }

  /// Example: Upload photo with error handling
  Future<void> uploadPhotoWithErrorHandling(
    BuildContext context,
    String imagePath,
    String regionId,
  ) async {
    try {
      // Show loading indicator
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Row(
              children: [
                SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                SizedBox(width: 16),
                Text('Uploading photo...'),
              ],
            ),
            duration: Duration(seconds: 30),
          ),
        );
      }

      // Attempt upload with 30-second timeout
      await _photoService.uploadPhoto(
        File(imagePath),
        regionId,
        timeoutSeconds: 30,
      );

      // Success
      if (context.mounted) {
        ScaffoldMessenger.of(context).hideCurrentSnackBar();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Photo uploaded successfully'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } on PhotoServiceException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).hideCurrentSnackBar();

        if (e.message.contains('timeout') || e.message.contains('Network')) {
          // Queue for offline upload
          await _photoService.queueOfflineUpload(
            File(imagePath),
            regionId,
          );

          ErrorHandler.showErrorSnackbar(
            context,
            'Photo queued for upload when connection is restored',
          );
        } else if (e.message.contains('too large')) {
          ErrorHandler.showErrorSnackbar(
            context,
            'Photo is too large. Please select a smaller image.',
          );
        } else {
          ErrorHandler.showErrorSnackbar(
            context,
            ErrorHandler.handlePhotoUploadError(e),
          );
        }
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).hideCurrentSnackBar();
        ErrorHandler.showErrorSnackbar(
          context,
          'Failed to upload photo: ${e.toString()}',
        );
      }
    }
  }

  /// Example: Request location permission with error handling
  Future<void> requestLocationPermissionWithErrorHandling(
    BuildContext context,
  ) async {
    try {
      final status = await _locationService.requestPermissions();

      if (status == 'denied' || status == 'restricted') {
        if (context.mounted) {
          await ErrorHandler.showSettingsDialog(
            context: context,
            title: 'Location Permission Required',
            message: ErrorHandler.handlePermissionError(null),
          );
        }
      }
    } on LocationPermissionException catch (e) {
      if (context.mounted) {
        await ErrorHandler.showSettingsDialog(
          context: context,
          title: 'Permission Denied',
          message: e.message,
        );
      }
    } catch (e) {
      if (context.mounted) {
        ErrorHandler.showErrorSnackbar(
          context,
          'Failed to request permission: ${e.toString()}',
        );
      }
    }
  }

  /// Example: Handle database corruption
  Future<void> handleDatabaseCorruption(BuildContext context) async {
    final shouldRebuild = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => DatabaseErrorWidget(
        onRebuild: () => Navigator.of(context).pop(true),
        onCancel: () => Navigator.of(context).pop(false),
      ),
    );

    if (shouldRebuild == true) {
      try {
        // Show loading
        if (context.mounted) {
          showDialog(
            context: context,
            barrierDismissible: false,
            builder: (context) => const LoadingWidget(
              message: 'Rebuilding database...',
            ),
          );
        }

        // Rebuild database
        await _storageService.rebuildDatabase();

        // Close loading dialog
        if (context.mounted) {
          Navigator.of(context).pop();

          // Show success
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Database rebuilt successfully'),
              backgroundColor: Colors.green,
            ),
          );
        }
      } catch (e) {
        if (context.mounted) {
          Navigator.of(context).pop();
          ErrorHandler.showErrorSnackbar(
            context,
            'Failed to rebuild database: ${e.toString()}',
          );
        }
      }
    }
  }

  /// Example: Handle region monitoring limit
  Future<void> handleRegionMonitoringLimit(
    BuildContext context,
    String errorMessage,
  ) async {
    await ErrorHandler.showErrorDialog(
      context: context,
      title: 'Monitoring Limit Reached',
      message:
          'iOS limits monitoring to 20 regions at a time. The app will automatically manage which regions to monitor based on your location.',
      showRetry: false,
    );
  }

  /// Example: Show ad with fallback
  Future<void> showRewardedAdWithFallback(
    BuildContext context,
    VoidCallback onRewardEarned,
  ) async {
    final adShown = await _adService.showRewardedAd(
      onComplete: onRewardEarned,
      onAdNotAvailable: () {
        if (context.mounted) {
          ErrorHandler.showErrorSnackbar(
            context,
            'Ad not available at the moment. Please try again later.',
          );
        }
      },
    );

    if (!adShown && context.mounted) {
      // Ad failed to show - allow user to proceed anyway
      final shouldProceed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Ad Not Available'),
          content: const Text(
            'The ad could not be loaded. Would you like to continue without watching the ad?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Continue'),
            ),
          ],
        ),
      );

      if (shouldProceed == true) {
        // Allow user to proceed without reward
        // This is graceful degradation
      }
    }
  }

  /// Example: Check database health on app start
  Future<void> checkDatabaseHealthOnStartup(BuildContext context) async {
    try {
      final isHealthy = await _storageService.checkDatabaseHealth();

      if (!isHealthy) {
        if (context.mounted) {
          await handleDatabaseCorruption(context);
        }
      }
    } catch (_) {
      if (context.mounted) {
        await handleDatabaseCorruption(context);
      }
    }
  }
}
