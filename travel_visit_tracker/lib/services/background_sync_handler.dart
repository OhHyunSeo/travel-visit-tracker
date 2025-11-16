import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';
import 'sync_service.dart';

/// Handler for iOS background fetch to trigger sync
class BackgroundSyncHandler {
  static final BackgroundSyncHandler _instance =
      BackgroundSyncHandler._internal();
  factory BackgroundSyncHandler() => _instance;
  BackgroundSyncHandler._internal();

  static const MethodChannel _channel =
      MethodChannel('com.travelvisittracker/sync');
  final SyncService _syncService = SyncService();

  bool _isInitialized = false;

  /// Initialize background sync handler
  void initialize() {
    if (_isInitialized) return;

    _channel.setMethodCallHandler(_handleMethodCall);
    _isInitialized = true;
    debugPrint('Background sync handler initialized');
  }

  /// Handle method calls from iOS
  Future<dynamic> _handleMethodCall(MethodCall call) async {
    switch (call.method) {
      case 'performBackgroundSync':
        return await _performBackgroundSync();
      default:
        throw PlatformException(
          code: 'NOT_IMPLEMENTED',
          message: 'Method ${call.method} not implemented',
        );
    }
  }

  /// Perform background sync
  Future<bool> _performBackgroundSync() async {
    try {
      debugPrint('Performing background sync...');
      await _syncService.processPendingUploads();
      debugPrint('Background sync completed');
      return true;
    } catch (e) {
      debugPrint('Background sync failed: $e');
      return false;
    }
  }
}
