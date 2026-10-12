import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:geolocator/geolocator.dart';
import 'package:sensors_plus/sensors_plus.dart';
import 'local_db_service.dart';

class BackgroundLocationService {
  static const String notificationChannelId = 'my_foreground';
  static const int notificationId = 888;

  Future<void> initialize() async {
    final service = FlutterBackgroundService();

    // Android Notification Channel
    const AndroidNotificationChannel channel = AndroidNotificationChannel(
      notificationChannelId,
      'MY FOREGROUND SERVICE',
      description: 'This channel is used for important notifications.',
      importance: Importance.low,
    );

    final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin =
        FlutterLocalNotificationsPlugin();

    if (Platform.isAndroid) {
      await flutterLocalNotificationsPlugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(channel);
    }

    await service.configure(
      androidConfiguration: AndroidConfiguration(
        onStart: onStart,
        autoStart: false,
        isForegroundMode: true,
        notificationChannelId: notificationChannelId,
        initialNotificationTitle: 'Travel Tracker',
        initialNotificationContent: 'Initializing...',
        foregroundServiceNotificationId: notificationId,
      ),
      iosConfiguration: IosConfiguration(
        autoStart: false,
        onForeground: onStart,
        onBackground: onIosBackground,
      ),
    );
  }

  @pragma('vm:entry-point')
  static Future<bool> onIosBackground(ServiceInstance service) async {
    // Basic iOS background fetch support
    // For real adaptive tracking on iOS, we rely on Significant Location Changes
    // managed implicitly by Geolocator or native code integration.
    // Here we just return true to indicate success.
    return true;
  }

  @pragma('vm:entry-point')
  static void onStart(ServiceInstance service) async {
    // Only available for flutter 3.0.0 and later
    DartPluginRegistrant.ensureInitialized();

    final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin =
        FlutterLocalNotificationsPlugin();

    // Initialize Local DB
    final localDb = LocalDbService();

    // Sensor stream subscription
    StreamSubscription<UserAccelerometerEvent>? _sensorSubscription;
    DateTime _lastMoveTime = DateTime.now();
    bool _isMoving = true; // Assume moving initially

    // Start listening to sensors to detect movement state (Adaptive Tracking)
    _sensorSubscription = userAccelerometerEventStream().listen((event) {
      // Calculate magnitude of acceleration
      double magnitude =
          sqrt(event.x * event.x + event.y * event.y + event.z * event.z);

      // Threshold for movement (adjust based on testing)
      if (magnitude > 1.0) {
        _lastMoveTime = DateTime.now();
        if (!_isMoving) {
          _isMoving = true;
          // Trigger immediate location update if we just started moving?
          service.invoke("status", {"status": "moving"});
        }
      }
    });

    // Periodic timer
    Timer.periodic(const Duration(seconds: 15), (timer) async {
      // Check if service is stopped
      if (service is AndroidServiceInstance) {
        if (await service.isForegroundService()) {
          // Check stationary state: if no movement for 5 minutes
          if (DateTime.now().difference(_lastMoveTime).inMinutes > 5) {
            _isMoving = false;
            flutterLocalNotificationsPlugin.show(
              notificationId,
              'Travel Tracker',
              'Stationary - GPS Paused',
              const NotificationDetails(
                android: AndroidNotificationDetails(
                  notificationChannelId,
                  'MY FOREGROUND SERVICE',
                  icon: 'ic_bg_service_small',
                  ongoing: true,
                ),
              ),
            );
            return; // Skip GPS update
          }

          flutterLocalNotificationsPlugin.show(
            notificationId,
            'Travel Tracker',
            'Tracking location... (Updated: ${DateTime.now().hour}:${DateTime.now().minute})',
            const NotificationDetails(
              android: AndroidNotificationDetails(
                notificationChannelId,
                'MY FOREGROUND SERVICE',
                icon: 'ic_bg_service_small',
                ongoing: true,
              ),
            ),
          );
        }
      }

      // Get Location
      try {
        Position position = await Geolocator.getCurrentPosition(
            desiredAccuracy: LocationAccuracy.high);

        // Save to Local DB
        // Assuming tripId 1 for now (needs proper Trip Management later)
        await localDb.insertStep(
          tripId: 1, 
          latitude: position.latitude,
          longitude: position.longitude,
          timestamp: DateTime.now(),
          accuracy: position.accuracy,
          altitude: position.altitude,
        );
        
        print('Location saved: ${position.latitude}, ${position.longitude}');
        
        service.invoke(
          'update',
          {
            "lat": position.latitude,
            "lng": position.longitude,
          },
        );
      } catch (e) {
        print('Location error: $e');
      }
    });
  }
  
  // Method to start tracking
  Future<void> startTracking() async {
    final service = FlutterBackgroundService();
    await service.startService();
  }

  // Method to stop tracking
  Future<void> stopTracking() async {
    final service = FlutterBackgroundService();
    service.invoke("stopService");
  }
}
