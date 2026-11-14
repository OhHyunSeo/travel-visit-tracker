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
}

private final class OfflineMapRequestGuard: URLProtocol, @unchecked Sendable {
  static let policy = OfflineMapRequestPolicy()

  override class func canInit(with request: URLRequest) -> Bool {
    guard let scheme = request.url?.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
      return false
    }
    return policy.isBlocked
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
  }

  override func stopLoading() {}
}

private final class OfflineMapRequestPolicy: @unchecked Sendable {
  private let lock = NSLock()
  private var blocked = false

  var isBlocked: Bool {
    lock.lock()
    defer { lock.unlock() }
    return blocked
  }

  func setBlocked(_ value: Bool) {
    lock.lock()
    blocked = value
    lock.unlock()
  }
}
