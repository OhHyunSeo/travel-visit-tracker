import Foundation

final class OfflineMapRequestGuard: URLProtocol, @unchecked Sendable {
  static let policy = OfflineMapRequestPolicy()

  override class func canInit(with request: URLRequest) -> Bool {
    policy.intercepts(request)
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    guard let document = Self.policy.localStyle(for: request),
          let response = HTTPURLResponse(url: document.url, statusCode: 200, httpVersion: nil,
                                         headerFields: [
                                           "Content-Type": "application/json; charset=utf-8",
                                           "Content-Length": String(document.bytes.count),
                                           "Cache-Control": "max-age=31536000, immutable",
                                         ])
    else {
      client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
      return
    }
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: document.bytes)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

final class OfflineMapRequestPolicy: @unchecked Sendable {
  struct LocalStyle {
    let url: URL
    let bytes: Data
    fileprivate let scope: TripPaintingMapRequestScope
  }

  private let lock = NSLock()
  private var blocked = false
  private var registeredStyle: LocalStyle?

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

  func registerStyle(_ scopeJSON: String, styleJSON: String, metadataJSON: String) -> URL? {
    guard let scope = TripPaintingMapRequestScope.validatePrepared(scopeJSON, styleJSON: styleJSON, metadataJSON: metadataJSON),
          let url = URL(string: "https://\(TripPaintingMapOperationRoute.host)/v1/\(scope.operationId)/\(scope.localStyleSha256).json")
    else { return nil }
    return register(LocalStyle(url: url, bytes: Data(styleJSON.utf8), scope: scope), requiresCacheOnly: false)
  }

  func registerOperationStyle(_ route: TripPaintingMapOperationRoute) -> URL? {
    register(LocalStyle(url: route.styleURL, bytes: route.styleBytes, scope: route.scope), requiresCacheOnly: true)
  }

  private func register(_ style: LocalStyle, requiresCacheOnly: Bool) -> URL? {
    lock.lock()
    defer { lock.unlock() }
    guard !requiresCacheOnly || blocked else { return nil }
    if let existing = registeredStyle {
      return existing.url == style.url && existing.scope == style.scope && existing.bytes == style.bytes ? existing.url : nil
    }
    registeredStyle = style
    return style.url
  }

  func intercepts(_ request: URLRequest) -> Bool {
    guard let scheme = request.url?.scheme?.lowercased(), scheme == "http" || scheme == "https"
    else { return false }
    // Even when external requests are enabled, the app's reserved host has no network route.
    let host = request.url?.host?.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
    return host == TripPaintingMapOperationRoute.host || isBlocked
  }

  func localStyle(for request: URLRequest) -> LocalStyle? {
    lock.lock()
    defer { lock.unlock() }
    guard let style = registeredStyle, request.url?.absoluteString == style.url.absoluteString,
          request.httpMethod == "GET", request.httpBody == nil, request.httpBodyStream == nil
    else { return nil }
    return style
  }
}
