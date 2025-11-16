import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';

/// Service for monitoring network connectivity status
class ConnectivityService {
  final Connectivity _connectivity = Connectivity();
  StreamSubscription<ConnectivityResult>? _subscription;

  bool _isOnline = false;
  final _statusController = StreamController<bool>.broadcast();

  /// Stream of connectivity status changes (true = online, false = offline)
  Stream<bool> get statusStream => _statusController.stream;

  /// Current connectivity status
  bool get isOnline => _isOnline;

  /// Initialize connectivity monitoring
  Future<void> initialize() async {
    // Check initial connectivity status
    final result = await _connectivity.checkConnectivity();
    _updateStatus(result);

    // Listen to connectivity changes
    _subscription = _connectivity.onConnectivityChanged.listen((result) {
      _updateStatus(result);
    });
  }

  void _updateStatus(ConnectivityResult result) {
    // Consider online if any connection type is available (wifi, mobile, ethernet)
    final wasOnline = _isOnline;
    _isOnline = result == ConnectivityResult.wifi ||
        result == ConnectivityResult.mobile ||
        result == ConnectivityResult.ethernet;

    // Notify listeners if status changed
    if (wasOnline != _isOnline) {
      _statusController.add(_isOnline);
    }
  }

  /// Dispose resources
  void dispose() {
    _subscription?.cancel();
    _statusController.close();
  }
}
