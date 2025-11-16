import 'package:flutter/material.dart';

/// Widget to display error messages with retry functionality
class ErrorRetryWidget extends StatelessWidget {
  final String title;
  final String message;
  final VoidCallback onRetry;
  final IconData icon;
  final bool showRetry;

  const ErrorRetryWidget({
    super.key,
    required this.title,
    required this.message,
    required this.onRetry,
    this.icon = Icons.error_outline,
    this.showRetry = true,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 64,
              color: Colors.red.shade300,
            ),
            const SizedBox(height: 16),
            Text(
              title,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Colors.grey.shade600,
                  ),
              textAlign: TextAlign.center,
            ),
            if (showRetry) ...[
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 32,
                    vertical: 12,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Widget for GeoJSON load errors
class GeoJSONErrorWidget extends StatelessWidget {
  final String countryCode;
  final String errorMessage;
  final VoidCallback onRetry;
  final bool hasCachedData;

  const GeoJSONErrorWidget({
    super.key,
    required this.countryCode,
    required this.errorMessage,
    required this.onRetry,
    this.hasCachedData = false,
  });

  @override
  Widget build(BuildContext context) {
    String title = 'Failed to Load Region Data';
    String message = errorMessage;
    IconData icon = Icons.cloud_off;

    if (errorMessage.contains('Network')) {
      title = 'Network Error';
      message = hasCachedData
          ? 'Unable to update region data. Using cached version.'
          : 'Unable to connect to server. Please check your internet connection.';
    } else if (errorMessage.contains('404') ||
        errorMessage.contains('not found')) {
      title = 'Region Not Available';
      message = 'Region data for $countryCode is not available yet.';
      icon = Icons.location_off;
    } else if (errorMessage.contains('timeout')) {
      title = 'Request Timed Out';
      message = 'The request took too long. Please try again.';
      icon = Icons.timer_off;
    }

    return ErrorRetryWidget(
      title: title,
      message: message,
      onRetry: onRetry,
      icon: icon,
    );
  }
}

/// Widget for database corruption errors
class DatabaseErrorWidget extends StatelessWidget {
  final VoidCallback onRebuild;
  final VoidCallback? onCancel;

  const DatabaseErrorWidget({
    super.key,
    required this.onRebuild,
    this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.storage,
              size: 64,
              color: Colors.orange.shade300,
            ),
            const SizedBox(height: 16),
            Text(
              'Database Issue Detected',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'The app database needs to be rebuilt. This will clear your local data, but you can re-download region information.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Colors.grey.shade600,
                  ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: onRebuild,
              icon: const Icon(Icons.build),
              label: const Text('Rebuild Database'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.orange,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(
                  horizontal: 32,
                  vertical: 12,
                ),
              ),
            ),
            if (onCancel != null) ...[
              const SizedBox(height: 12),
              TextButton(
                onPressed: onCancel,
                child: const Text('Cancel'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Widget for permission denied errors
class PermissionDeniedWidget extends StatelessWidget {
  final VoidCallback onOpenSettings;
  final String permissionType;

  const PermissionDeniedWidget({
    super.key,
    required this.onOpenSettings,
    this.permissionType = 'Location',
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.location_off,
              size: 64,
              color: Colors.amber.shade700,
            ),
            const SizedBox(height: 16),
            Text(
              '$permissionType Permission Required',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'This app needs $permissionType permission to automatically track your visits. Please enable it in Settings.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Colors.grey.shade600,
                  ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: onOpenSettings,
              icon: const Icon(Icons.settings),
              label: const Text('Open Settings'),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                  horizontal: 32,
                  vertical: 12,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Loading widget with message
class LoadingWidget extends StatelessWidget {
  final String message;

  const LoadingWidget({
    super.key,
    this.message = 'Loading...',
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(
            message,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Colors.grey.shade600,
                ),
          ),
        ],
      ),
    );
  }
}
