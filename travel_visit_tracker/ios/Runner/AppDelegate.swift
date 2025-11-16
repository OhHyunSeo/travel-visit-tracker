import UIKit
import Flutter

@UIApplicationMain
@objc class AppDelegate: FlutterAppDelegate {
  private var locationService: LocationService?
  private var syncMethodChannel: FlutterMethodChannel?
  
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    
    // Set minimum background fetch interval (4 hours = 14400 seconds)
    application.setMinimumBackgroundFetchInterval(14400)
    
    // Set up location service method channel
    let controller = window?.rootViewController as! FlutterViewController
    let methodChannel = FlutterMethodChannel(
      name: "com.travelvisittracker/location",
      binaryMessenger: controller.binaryMessenger
    )
    
    let eventChannel = FlutterEventChannel(
      name: "com.travelvisittracker/location_events",
      binaryMessenger: controller.binaryMessenger
    )
    
    // Set up sync method channel for background fetch
    syncMethodChannel = FlutterMethodChannel(
      name: "com.travelvisittracker/sync",
      binaryMessenger: controller.binaryMessenger
    )
    
    locationService = LocationService()
    let eventHandler = LocationEventStreamHandler(locationService: locationService!)
    eventChannel.setStreamHandler(eventHandler)
    
    methodChannel.setMethodCallHandler { [weak self] (call, result) in
      guard let self = self, let service = self.locationService else {
        result(FlutterError(code: "UNAVAILABLE", message: "Location service not available", details: nil))
        return
      }
      
      switch call.method {
      case "requestPermissions":
        service.requestPermissions(result: result)
        
      case "startMonitoring":
        if let args = call.arguments as? [String: Any],
           let regions = args["regions"] as? [[String: Any]] {
          service.startMonitoring(regions: regions, result: result)
        } else {
          result(FlutterError(code: "INVALID_ARGS", message: "Invalid arguments", details: nil))
        }
        
      case "stopMonitoring":
        if let args = call.arguments as? [String: Any],
           let regionIds = args["regionIds"] as? [String] {
          service.stopMonitoring(regionIds: regionIds, result: result)
        } else {
          result(FlutterError(code: "INVALID_ARGS", message: "Invalid arguments", details: nil))
        }
        
      case "getMonitoringStatus":
        service.getMonitoringStatus(result: result)
        
      case "getCurrentLocation":
        service.getCurrentLocation(result: result)
        
      case "updateMonitoredRegions":
        if let args = call.arguments as? [String: Any],
           let allRegions = args["allRegions"] as? [[String: Any]] {
          service.updateMonitoredRegions(allRegions: allRegions, result: result)
        } else {
          result(FlutterError(code: "INVALID_ARGS", message: "Invalid arguments", details: nil))
        }
        
      default:
        result(FlutterMethodNotImplemented)
      }
    }
    
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
  
  // Background fetch handler
  override func application(
    _ application: UIApplication,
    performFetchWithCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    NSLog("Background fetch triggered")
    
    // Call Flutter sync service via method channel
    syncMethodChannel?.invokeMethod("performBackgroundSync", arguments: nil) { result in
      if let error = result as? FlutterError {
        NSLog("Background sync failed: \(error.message ?? "Unknown error")")
        completionHandler(.failed)
      } else if result is FlutterMethodNotImplemented {
        NSLog("Background sync not implemented")
        completionHandler(.noData)
      } else {
        NSLog("Background sync completed successfully")
        completionHandler(.newData)
      }
    }
  }
}
