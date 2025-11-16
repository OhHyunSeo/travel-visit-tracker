import 'package:flutter/foundation.dart';
import '../services/connectivity_service.dart';

/// State provider for network connectivity status
class ConnectivityState extends ChangeNotifier {
  final ConnectivityService _connectivityService;
  bool _isOnline = false;

  ConnectivityState(this._connectivityService) {
    _initialize();
  }

  /// Current online status
  bool get isOnline => _isOnline;

  Future<void> _initialize() async {
    await _connectivityService.initialize();
    _isOnline = _connectivityService.isOnline;
    notifyListeners();

    // Listen to connectivity changes
    _connectivityService.statusStream.listen((online) {
      _isOnline = online;
      notifyListeners();
    });
  }

  @override
  void dispose() {
    _connectivityService.dispose();
    super.dispose();
  }
}
