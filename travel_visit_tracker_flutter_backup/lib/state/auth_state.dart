import 'package:flutter/material.dart';
import '../models/user.dart';
import '../services/auth_service.dart';

class AuthState extends ChangeNotifier {
  final AuthService _authService = AuthService();
  User? _currentUser;
  bool _isLoading = true;
  bool _isAuthenticated = false;

  User? get currentUser => _currentUser;
  bool get isLoading => _isLoading;
  bool get isAuthenticated => _isAuthenticated;

  AuthState() {
    _initializeAuth();
  }

  // Initialize authentication state on app start
  Future<void> _initializeAuth() async {
    _isLoading = true;
    notifyListeners();

    final result = await _authService.getCurrentUser();
    if (result['success'] == true) {
      _currentUser = result['user'];
      _isAuthenticated = true;
    } else {
      _currentUser = null;
      _isAuthenticated = false;
    }

    _isLoading = false;
    notifyListeners();
  }

  // Sign up new user
  Future<Map<String, dynamic>> signup({
    required String email,
    required String password,
    required String username,
  }) async {
    final result = await _authService.signup(
      email: email,
      password: password,
      username: username,
    );

    if (result['success'] == true) {
      _currentUser = result['user'];
      _isAuthenticated = true;
      notifyListeners();
    }

    return result;
  }

  // Login user
  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) async {
    final result = await _authService.login(
      email: email,
      password: password,
    );

    if (result['success'] == true) {
      _currentUser = result['user'];
      _isAuthenticated = true;
      notifyListeners();
    }

    return result;
  }

  // Logout user
  Future<void> logout() async {
    await _authService.logout();
    _currentUser = null;
    _isAuthenticated = false;
    notifyListeners();
  }
}
