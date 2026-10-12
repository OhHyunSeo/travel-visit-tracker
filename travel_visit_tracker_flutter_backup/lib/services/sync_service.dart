import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'auth_service.dart';
import 'local_db_service.dart';
import '../models/user.dart'; // Make sure this exists

class SyncService {
  final AuthService _authService = AuthService();
  final LocalDbService _localDbService = LocalDbService();
  bool _isSyncing = false;

  // Trigger synchronization
  Future<void> syncData() async {
    if (_isSyncing) return;
    _isSyncing = true;

    try {
      print('Starting sync...');
      await _syncSteps();
      print('Sync completed.');
    } catch (e) {
      print('Sync failed: $e');
    } finally {
      _isSyncing = false;
    }
  }

  // Sync steps
  Future<void> _syncSteps() async {
    final unsyncedSteps = await _localDbService.getUnsyncedSteps();
    if (unsyncedSteps.isEmpty) return;

    final token = await _authService.getToken();
    if (token == null) {
      print('Cannot sync: No auth token');
      return;
    }

    // Prepare steps for bulk upload
    // In a real app, we might want to batch these (e.g., 50 at a time)
    final stepsPayload = unsyncedSteps.map((step) {
      return {
        'local_id': step['id'],
        'trip_id': step['trip_id'],
        'latitude': step['latitude'],
        'longitude': step['longitude'],
        'timestamp': step['timestamp'],
        'accuracy': step['accuracy'],
        'altitude': step['altitude'],
        'type': step['type'],
      };
    }).toList();

    try {
      // Assuming a backend endpoint '/api/trips/sync'
      // We will need to implement this in the backend
      final response = await http.post(
        Uri.parse('${AuthService.baseUrl}/api/trips/sync'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({'steps': stepsPayload}),
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final result = jsonDecode(response.body);
        final syncedIds = List<int>.from(result['synced_ids']);
        
        // Mark as synced in local DB
        await _localDbService.markStepsAsSynced(syncedIds);
        print('Successfully synced ${syncedIds.length} steps');
      } else {
        print('Sync error: ${response.statusCode} - ${response.body}');
        // Optional: Mark as error if it's a 4xx error (bad request)
        // But for 5xx (server error), we keep them as pending to retry later.
        if (response.statusCode >= 400 && response.statusCode < 500) {
           // Maybe mark as error to stop retrying if data is invalid
           // _localDbService.markStepsAsError(...)
        }
      }
    } catch (e) {
      print('Network error during sync: $e');
      rethrow;
    }
  }
}
