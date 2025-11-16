import 'package:flutter/material.dart';
import 'dart:io';
import 'dart:async';

/// Custom exception types for better error categorization
class NetworkException implements Exception {
  final String message;
  NetworkException(this.message);

  @override
  String toString() => 'NetworkException: $message';
}

class DatabaseException implements Exception {
  final String message;
  DatabaseException(this.message);

  @override
  String toString() => 'DatabaseException: $message';
}

class PermissionException implements Exception {
  final String message;
  PermissionException(this.message);

  @override
  String toString() => 'PermissionException: $message';
}

class RegionMonitoringException implements Exception {
  final String message;
  RegionMonitoringException(this.message);

  @override
  String toString() => 'RegionMonitoringException: $message';
}

/// Error handler utility for consistent error handling across the app
class ErrorHandler {
  /// Show error dialog with retry option
  static Future<bool> showErrorDialog({
    required BuildContext context,
    required String title,
    required String message,
    bool showRetry = true,
    VoidCallback? onRetry,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          if (showRetry)
            TextButton(
              onPressed: () {
                Navigator.of(context).pop(true);
                onRetry?.call();
              },
              child: const Text('Retry'),
            ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(showRetry ? 'Cancel' : 'OK'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  /// Show error snackbar
  static void showErrorSnackbar(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red,
        duration: const Duration(seconds: 4),
        action: SnackBarAction(
          label: 'Dismiss',
          textColor: Colors.white,
          onPressed: () {
            ScaffoldMessenger.of(context).hideCurrentSnackBar();
          },
        ),
      ),
    );
  }

  /// Show settings navigation dialog
  static Future<void> showSettingsDialog({
    required BuildContext context,
    required String title,
    required String message,
  }) async {
    await showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(context).pop();
              // Open app settings - implementation depends on platform
              // This would typically use a plugin like app_settings
            },
            child: const Text('Open Settings'),
          ),
        ],
      ),
    );
  }

  /// Handle GeoJSON load errors
  static String handleGeoJSONError(dynamic error) {
    if (error is SocketException) {
      return 'Network error: Unable to connect to server. Please check your internet connection.';
    } else if (error is TimeoutException) {
      return 'Request timed out. Please try again.';
    } else if (error is FormatException) {
      return 'Invalid data format received. Please try again later.';
    } else if (error.toString().contains('404')) {
      return 'Region data not found. This country may not be supported yet.';
    } else {
      return 'Failed to load region data: ${error.toString()}';
    }
  }

  /// Handle photo upload errors
  static String handlePhotoUploadError(dynamic error) {
    if (error is SocketException) {
      return 'Network error: Photo will be uploaded when connection is restored.';
    } else if (error is TimeoutException) {
      return 'Upload timed out. Photo will be retried automatically.';
    } else if (error.toString().contains('413')) {
      return 'Photo is too large. Please select a smaller image.';
    } else {
      return 'Failed to upload photo: ${error.toString()}';
    }
  }

  /// Handle location permission errors
  static String handlePermissionError(dynamic error) {
    return 'Location permission is required for automatic visit tracking. Please enable it in Settings.';
  }

  /// Handle database errors
  static String handleDatabaseError(dynamic error) {
    if (error.toString().contains('corrupt')) {
      return 'Database corruption detected. Would you like to rebuild the database?';
    } else {
      return 'Database error: ${error.toString()}';
    }
  }

  /// Handle region monitoring errors
  static String handleRegionMonitoringError(dynamic error) {
    if (error.toString().contains('limit exceeded')) {
      return 'Region monitoring limit reached. Some regions may not be monitored.';
    } else {
      return 'Failed to monitor regions: ${error.toString()}';
    }
  }

  /// Handle ad load errors
  static String handleAdError(dynamic error) {
    return 'Ad not available at the moment. You can continue without watching the ad.';
  }

  /// Check if error is recoverable
  static bool isRecoverableError(dynamic error) {
    return error is SocketException ||
        error is TimeoutException ||
        error.toString().contains('Network') ||
        error.toString().contains('timeout');
  }

  /// Get user-friendly error message
  static String getUserFriendlyMessage(dynamic error) {
    if (error is NetworkException) {
      return 'Network connection issue. Please check your internet.';
    } else if (error is DatabaseException) {
      return 'Data storage issue. Please try restarting the app.';
    } else if (error is PermissionException) {
      return 'Permission required. Please enable in Settings.';
    } else if (error is RegionMonitoringException) {
      return 'Location monitoring issue. Please check location settings.';
    } else if (error is SocketException) {
      return 'Unable to connect to server. Please check your internet.';
    } else if (error is TimeoutException) {
      return 'Request timed out. Please try again.';
    } else if (error is FormatException) {
      return 'Invalid data received. Please try again.';
    } else {
      return 'An unexpected error occurred. Please try again.';
    }
  }
}
