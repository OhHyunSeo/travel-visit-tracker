import Foundation
import CoreLocation
import Flutter

class LocationService: NSObject, CLLocationManagerDelegate {
    private let locationManager = CLLocationManager()
    private var eventSink: FlutterEventSink?
    private var monitoredRegionIds: Set<String> = []
    private var lastRotationLocation: CLLocation?
    private let rotationThresholdMeters: Double = 1000.0
    private let maxMonitoredRegions = 20
    
    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.startUpdatingLocation()
    }
    
    // MARK: - Method Channel Handlers
    
    func requestPermissions(result: @escaping FlutterResult) {
        let status = CLLocationManager.authorizationStatus()
        
        switch status {
        case .notDetermined:
            // Request When In Use first
            locationManager.requestWhenInUseAuthorization()
            result("requesting")
        case .authorizedWhenInUse:
            // Upgrade to Always
            locationManager.requestAlwaysAuthorization()
            result("whenInUse")
        case .authorizedAlways:
            result("always")
        case .denied, .restricted:
            result("denied")
        @unknown default:
            result("unknown")
        }
    }
    
    func startMonitoring(regions: [[String: Any]], result: @escaping FlutterResult) {
        var registeredCount = 0
        
        for regionData in regions {
            guard let regionId = regionData["id"] as? String,
                  let lat = regionData["lat"] as? Double,
                  let lng = regionData["lng"] as? Double,
                  let radius = regionData["radius"] as? Double else {
                continue
            }
            
            let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
            let region = CLCircularRegion(center: coordinate, radius: radius, identifier: regionId)
            region.notifyOnEntry = true
            region.notifyOnExit = true
            
            locationManager.startMonitoring(for: region)
            monitoredRegionIds.insert(regionId)
            registeredCount += 1
        }
        
        result(["success": true, "count": registeredCount])
    }
    
    func stopMonitoring(regionIds: [String], result: @escaping FlutterResult) {
        var unregisteredCount = 0
        
        for regionId in regionIds {
            if let region = locationManager.monitoredRegions.first(where: { $0.identifier == regionId }) {
                locationManager.stopMonitoring(for: region)
                monitoredRegionIds.remove(regionId)
                unregisteredCount += 1
            }
        }
        
        result(["success": true, "count": unregisteredCount])
    }
    
    func getMonitoringStatus(result: @escaping FlutterResult) {
        let monitoredRegions = locationManager.monitoredRegions.map { region in
            return [
                "id": region.identifier,
                "lat": (region as? CLCircularRegion)?.center.latitude ?? 0,
                "lng": (region as? CLCircularRegion)?.center.longitude ?? 0,
                "radius": (region as? CLCircularRegion)?.radius ?? 0
            ]
        }
        
        result([
            "count": monitoredRegions.count,
            "regions": monitoredRegions,
            "maxRegions": 20
        ])
    }
    
    func getCurrentLocation(result: @escaping FlutterResult) {
        if let location = locationManager.location {
            result([
                "lat": location.coordinate.latitude,
                "lng": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy
            ])
        } else {
            result(FlutterError(code: "NO_LOCATION", message: "Location not available", details: nil))
        }
    }
    
    func updateMonitoredRegions(allRegions: [[String: Any]], result: @escaping FlutterResult) {
        guard let currentLocation = locationManager.location else {
            result(FlutterError(code: "NO_LOCATION", message: "Current location not available", details: nil))
            return
        }
        
        // Check if we've moved enough to warrant rotation
        if let lastLocation = lastRotationLocation {
            let distance = currentLocation.distance(from: lastLocation)
            if distance < rotationThresholdMeters {
                result(["success": true, "rotated": false, "reason": "threshold_not_met"])
                return
            }
        }
        
        // Calculate distances to all regions
        var regionDistances: [(id: String, distance: Double, data: [String: Any])] = []
        
        for regionData in allRegions {
            guard let regionId = regionData["id"] as? String,
                  let lat = regionData["lat"] as? Double,
                  let lng = regionData["lng"] as? Double else {
                continue
            }
            
            let regionLocation = CLLocation(latitude: lat, longitude: lng)
            let distance = currentLocation.distance(from: regionLocation)
            
            regionDistances.append((id: regionId, distance: distance, data: regionData))
        }
        
        // Sort by distance and select top 20
        regionDistances.sort { $0.distance < $1.distance }
        let nearest20 = Array(regionDistances.prefix(maxMonitoredRegions))
        let nearest20Ids = Set(nearest20.map { $0.id })
        
        // Find regions to unregister (currently monitored but not in top 20)
        let currentlyMonitored = Set(locationManager.monitoredRegions.map { $0.identifier })
        let toUnregister = currentlyMonitored.subtracting(nearest20Ids)
        
        // Find regions to register (in top 20 but not currently monitored)
        let toRegister = nearest20.filter { !currentlyMonitored.contains($0.id) }
        
        // Unregister furthest regions
        for regionId in toUnregister {
            if let region = locationManager.monitoredRegions.first(where: { $0.identifier == regionId }) {
                locationManager.stopMonitoring(for: region)
                monitoredRegionIds.remove(regionId)
            }
        }
        
        // Register new regions
        for regionInfo in toRegister {
            guard let lat = regionInfo.data["lat"] as? Double,
                  let lng = regionInfo.data["lng"] as? Double else {
                continue
            }
            
            let radius = regionInfo.data["radius"] as? Double ?? 500.0
            let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
            let region = CLCircularRegion(center: coordinate, radius: radius, identifier: regionInfo.id)
            region.notifyOnEntry = true
            region.notifyOnExit = true
            
            locationManager.startMonitoring(for: region)
            monitoredRegionIds.insert(regionInfo.id)
        }
        
        // Update last rotation location
        lastRotationLocation = currentLocation
        
        // Persist monitored slots (will be handled by Flutter side via storage service)
        let monitoredList = Array(monitoredRegionIds)
        
        result([
            "success": true,
            "rotated": true,
            "unregistered": toUnregister.count,
            "registered": toRegister.count,
            "totalMonitored": monitoredRegionIds.count,
            "monitoredRegionIds": monitoredList
        ])
    }
    
    // MARK: - CLLocationManagerDelegate
    
    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard let circularRegion = region as? CLCircularRegion else { return }
        
        let event: [String: Any] = [
            "type": "enter",
            "regionId": region.identifier,
            "timestamp": Date().timeIntervalSince1970,
            "lat": circularRegion.center.latitude,
            "lng": circularRegion.center.longitude
        ]
        
        eventSink?(event)
    }
    
    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        guard let circularRegion = region as? CLCircularRegion else { return }
        
        let event: [String: Any] = [
            "type": "exit",
            "regionId": region.identifier,
            "timestamp": Date().timeIntervalSince1970,
            "lat": circularRegion.center.latitude,
            "lng": circularRegion.center.longitude
        ]
        
        eventSink?(event)
    }
    
    func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        let statusString: String
        
        switch status {
        case .notDetermined:
            statusString = "notDetermined"
        case .restricted:
            statusString = "restricted"
        case .denied:
            statusString = "denied"
        case .authorizedAlways:
            statusString = "authorizedAlways"
        case .authorizedWhenInUse:
            statusString = "authorizedWhenInUse"
        @unknown default:
            statusString = "unknown"
        }
        
        let event: [String: Any] = [
            "type": "authorizationChanged",
            "status": statusString
        ]
        
        eventSink?(event)
    }
    
    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        let event: [String: Any] = [
            "type": "error",
            "error": error.localizedDescription,
            "regionId": region?.identifier ?? "unknown"
        ]
        
        eventSink?(event)
    }
    
    // MARK: - Event Channel
    
    func setEventSink(_ sink: FlutterEventSink?) {
        self.eventSink = sink
    }
}

// MARK: - Event Channel Handler

class LocationEventStreamHandler: NSObject, FlutterStreamHandler {
    private let locationService: LocationService
    
    init(locationService: LocationService) {
        self.locationService = locationService
    }
    
    func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
        locationService.setEventSink(events)
        return nil
    }
    
    func onCancel(withArguments arguments: Any?) -> FlutterError? {
        locationService.setEventSink(nil)
        return nil
    }
}
