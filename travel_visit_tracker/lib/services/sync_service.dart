import 'dart:async';
import 'package:flutter/foundation.dart';
import 'photo_service.dart';
import 'storage_service.dart';
import 'connectivity_service.dart';

/// Service for synchronizing pending data when connectivity is restored
class SyncService {
  static final SyncService _instance = SyncService._internal();
  factory SyncService() => _instance;
  SyncService._internal();

  final PhotoService _photoService = PhotoService();
  final StorageService _storageService = StorageService();

  bool _isSyncing = false;
  DateTime? _lastSyncTime;
  StreamSubscription<bool>? _connectivitySubscription;

  final _syncStatusController = StreamController<SyncStatus>.broadcast();

  /// Stream of sync status updates
  Stream<SyncStatus> get syncStatusStream => _syncStatusController.stream;

  /// Whether a sync is currently in progress
  bool get isSyncing => _isSyncing;

  /// Last successful sync time
  DateTime? get lastSyncTime => _lastSyncTime;

  /// Initialize sync service with connectivity monitoring
  void initialize(ConnectivityService connectivityService) {
    // Listen to connectivity changes and trigger sync when online
    _connectivitySubscription =
        connectivityService.statusStream.listen((isOnline) {
      if (isOnline && !_isSyncing) {
        debugPrint('Connectivity restored, triggering sync');
        processPendingUploads();
      }
    });
  }

  /// Process all pending photo uploads
  Future<void> processPendingUploads() async {
    if (_isSyncing) {
      debugPrint('Sync already in progress, skipping');
      return;
    }

    _isSyncing = true;
    _syncStatusController.add(SyncStatus.syncing);

    try {
      // Get pending photos count
      final pendingPhotos = await _storageService.getPendingPhotos();
      final totalCount = pendingPhotos.length;

      if (totalCount == 0) {
        debugPrint('No pending uploads to process');
        _syncStatusController.add(SyncStatus.idle);
        _lastSyncTime = DateTime.now();
        await _updateLastSyncTime();
        return;
      }

      debugPrint('Processing $totalCount pending uploads');

      // Process uploads
      await _photoService.processPendingUploads();

      // Update last sync time
      _lastSyncTime = DateTime.now();
      await _updateLastSyncTime();

      _syncStatusController.add(SyncStatus.success);
      debugPrint('Sync completed successfully');
    } catch (e) {
      debugPrint('Sync failed: $e');
      _syncStatusController.add(SyncStatus.error);
    } finally {
      _isSyncing = false;
      // Return to idle after a brief delay
      Future.delayed(const Duration(seconds: 2), () {
        _syncStatusController.add(SyncStatus.idle);
      });
    }
  }

  /// Get count of pending uploads
  Future<int> getPendingUploadCount() async {
    final pendingPhotos = await _storageService.getPendingPhotos();
    return pendingPhotos.length;
  }

  /// Load last sync time from storage
  Future<void> loadLastSyncTime() async {
    final lastSyncStr = await _storageService.getAppState('last_sync_time');
    if (lastSyncStr != null) {
      _lastSyncTime = DateTime.tryParse(lastSyncStr);
    }
  }

  /// Update last sync time in storage
  Future<void> _updateLastSyncTime() async {
    if (_lastSyncTime != null) {
      await _storageService.setAppState(
        'last_sync_time',
        _lastSyncTime!.toIso8601String(),
      );
    }
  }

  /// Dispose resources
  void dispose() {
    _connectivitySubscription?.cancel();
    _syncStatusController.close();
  }
}

/// Sync status enum
enum SyncStatus {
  idle,
  syncing,
  success,
  error,
}
