import Foundation
import MapLibre

@objc(TripPaintingMapBootstrap)
public final class TripPaintingMapBootstrap: NSObject {
  @discardableResult
  @objc(configureInDirectory:)
  public static func configure(in directory: URL = Bundle.main.bundleURL) -> Bool {
    guard directory.isFileURL, let options = MLNSettings.tileServerOptions else { return false }

    installOfflineRequestGuard()

    // Keep a local URL even when the file is missing, so the SDK never selects its remote default.
    let url = directory.appendingPathComponent("TripPaintingBootstrapStyle.json")
    let style = MLNDefaultStyle()
    style.url = url
    style.name = "Trip Painting local bootstrap"
    style.version = 1
    options.defaultStyles = options.defaultStyles.filter { $0.name != style.name } + [style]
    options.defaultStyle = style
    MLNSettings.tileServerOptions = options
    return MLNStyle.defaultStyleURL() == url
  }

  // Call during startup, before the SDK creates its first session.
  private static func installOfflineRequestGuard() {
    let network = MLNNetworkConfiguration.sharedManager
    let current = network.sessionConfiguration ?? .default
    let guardType = ObjectIdentifier(OfflineMapRequestGuard.self)
    let protocols = current.protocolClasses ?? []
    if protocols.first.map(ObjectIdentifier.init) == guardType { return }
    guard let configuration = current.copy() as? URLSessionConfiguration else { return }
    configuration.protocolClasses = [OfflineMapRequestGuard.self] + protocols.filter {
      ObjectIdentifier($0) != guardType
    }
    network.sessionConfiguration = configuration
  }

  // Applies to new HTTP(S) requests on the MapLibre session. It does not cancel requests already in flight.
  @objc public static func setOfflineMapRequestsBlocked(_ blocked: Bool) {
    OfflineMapRequestGuard.policy.setBlocked(blocked)
  }

  @objc public static func isCacheOnly() -> Bool {
    let config = MLNNetworkConfiguration.sharedManager.sessionConfiguration ?? .default
    guard OfflineMapRequestGuard.policy.isBlocked,
          let first = config.protocolClasses?.first
    else { return false }
    return ObjectIdentifier(first) == ObjectIdentifier(OfflineMapRequestGuard.self)
  }

  @objc(validateDownloadScope:styleJSON:metadataJSON:)
  public static func validateDownloadScope(_ scopeJSON: String, styleJSON: String, metadataJSON: String) -> Bool {
    TripPaintingMapRequestScope.validatePrepared(scopeJSON, styleJSON: styleJSON, metadataJSON: metadataJSON) != nil
  }

  @objc(registerPreparedStyle:styleJSON:metadataJSON:)
  public static func registerPreparedStyle(_ scopeJSON: String, styleJSON: String, metadataJSON: String) -> String? {
    guard isCacheOnly() else { return nil }
    return OfflineMapRequestGuard.policy.registerStyle(scopeJSON, styleJSON: styleJSON, metadataJSON: metadataJSON)?.absoluteString
  }
}
