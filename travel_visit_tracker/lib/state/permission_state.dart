import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/location_service.dart';

enum PermissionStatus {
  notDetermined,
  restricted,
  denied,
  authorizedWhenInUse,
  authorizedAlways,
  unknown,
}

class PermissionState extends ChangeNotifier {
  final LocationService _locationService;
  PermissionStatus _status = PermissionStatus.notDetermined;
  bool _isRequestingPermission = false;
  String? _errorMessage;

  PermissionState(this._locationService) {
    _locationService.addEventListener(_handleLocationEvent);
  }

  PermissionStatus get status => _status;
  bool get isRequestingPermission => _isRequestingPermission;
  String? get errorMessage => _errorMessage;

  bool get hasWhenInUsePermission =>
      _status == PermissionStatus.authorizedWhenInUse ||
      _status == PermissionStatus.authorizedAlways;

  bool get hasAlwaysPermission => _status == PermissionStatus.authorizedAlways;

  bool get isDenied =>
      _status == PermissionStatus.denied ||
      _status == PermissionStatus.restricted;

  bool get canRequestPermission =>
      _status == PermissionStatus.notDetermined ||
      _status == PermissionStatus.authorizedWhenInUse;

  void _handleLocationEvent(LocationEvent event) {
    if (event.isAuthorizationChanged) {
      _updateStatusFromString(event.status ?? 'unknown');
      notifyListeners();
    }
  }

  void _updateStatusFromString(String statusString) {
    switch (statusString) {
      case 'notDetermined':
        _status = PermissionStatus.notDetermined;
        break;
      case 'restricted':
        _status = PermissionStatus.restricted;
        break;
      case 'denied':
        _status = PermissionStatus.denied;
        break;
      case 'authorizedWhenInUse':
      case 'whenInUse':
        _status = PermissionStatus.authorizedWhenInUse;
        break;
      case 'authorizedAlways':
      case 'always':
        _status = PermissionStatus.authorizedAlways;
        break;
      default:
        _status = PermissionStatus.unknown;
    }
  }

  /// Request location permissions with proper sequence
  /// First requests "When In Use", then "Always" if granted
  Future<void> requestPermissions(BuildContext context) async {
    if (_isRequestingPermission) return;

    _isRequestingPermission = true;
    _errorMessage = null;
    notifyListeners();

    try {
      // Request permissions from location service
      final result = await _locationService.requestPermissions();
      _updateStatusFromString(result);

      // Handle the result
      if (result == 'requesting') {
        // Permission dialog is shown, wait for user response
        // The authorization change event will update the status
      } else if (result == 'whenInUse') {
        // User granted When In Use, now request Always
        await _showAlwaysPermissionRationale(context);
      } else if (result == 'denied') {
        // User denied permission
        _errorMessage =
            'Location permission is required for automatic visit tracking';
      }
    } catch (e) {
      _errorMessage = 'Failed to request permissions: $e';
    } finally {
      _isRequestingPermission = false;
      notifyListeners();
    }
  }

  /// Show rationale for Always permission and request it
  Future<void> _showAlwaysPermissionRationale(BuildContext context) async {
    if (!context.mounted) return;

    final shouldRequest = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Text('Enable Background Tracking'),
        content: const Text(
          'To automatically track your visits even when the app is closed, '
          'we need "Always" location permission.\n\n'
          'This allows you to never miss a region visit and keeps your travel '
          'history complete without any manual input.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Not Now'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Enable'),
          ),
        ],
      ),
    );

    if (shouldRequest == true) {
      try {
        final result = await _locationService.requestPermissions();
        _updateStatusFromString(result);
        notifyListeners();
      } catch (e) {
        _errorMessage = 'Failed to request Always permission: $e';
        notifyListeners();
      }
    }
  }

  /// Show rationale when user denies permission with option to open settings
  Future<void> showDenialRationale(BuildContext context) async {
    if (!context.mounted) return;

    final shouldOpenSettings = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Location Permission Required'),
        content: const Text(
          'Travel Visit Tracker needs location access to automatically detect '
          'when you visit new regions.\n\n'
          'Without this permission, you won\'t be able to track your travels '
          'automatically.\n\n'
          'Please enable location access in Settings.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Open Settings'),
          ),
        ],
      ),
    );

    if (shouldOpenSettings == true) {
      await openAppSettings();
    }
  }

  /// Open app settings for the user to manually enable permissions
  Future<void> openAppSettings() async {
    try {
      // iOS app settings URL
      final uri = Uri.parse('app-settings:');
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri);
      }
    } catch (e) {
      _errorMessage = 'Failed to open settings: $e';
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _locationService.removeEventListener(_handleLocationEvent);
    super.dispose();
  }
}
