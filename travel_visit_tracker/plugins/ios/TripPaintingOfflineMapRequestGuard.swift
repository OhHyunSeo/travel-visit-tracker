import Foundation

final class OfflineMapRequestGuard: URLProtocol, @unchecked Sendable {
  static let policy = OfflineMapRequestPolicy()

  private let state = NSLock()
  private var stopped = false
  private var operation: TripPaintingMapQueuedResource?
  // Accessed only on the bound operation's serial queue.
  private var requestID: UUID?

  override class func canInit(with request: URLRequest) -> Bool {
    policy.intercepts(request)
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    if let document = Self.policy.localStyle(for: request),
       let response = HTTPURLResponse(url: document.url, statusCode: 200, httpVersion: nil,
                                      headerFields: [
                                        "Content-Type": "application/json; charset=utf-8",
                                        "Content-Length": String(document.bytes.count),
                                        "Cache-Control": "max-age=31536000, immutable",
                                      ]) {
      return send(.success((response, document.bytes)))
    }
    let request = self.request
    guard let operation = Self.policy.operation(for: request) else {
      return send(.failure(URLError(.notConnectedToInternet)))
    }
    state.lock()
    let shouldStart = !stopped && self.operation == nil
    if shouldStart { self.operation = operation }
    state.unlock()
    guard shouldStart else { return }

    operation.queue.async { [self] in
      guard !isStopped else { return }
      guard Self.policy.isActive(operation) else { return send(.failure(URLError(.cancelled))) }
      requestID = operation.start(request) { [self] result in
        requestID = nil
        // The operation may be revoked while its completion is waiting to reach the client.
        send(Self.policy.isActive(operation) ? result : .failure(URLError(.cancelled)))
      }
      if requestID == nil { send(.failure(URLError(.notConnectedToInternet))) }
    }
  }

  override func stopLoading() {
    state.lock()
    stopped = true
    let operation = self.operation
    self.operation = nil
    state.unlock()
    guard let operation else { return }
    operation.queue.async { [self] in
      guard let id = requestID else { return }
      requestID = nil
      operation.cancel(id)
    }
  }

  private var isStopped: Bool {
    state.lock()
    defer { state.unlock() }
    return stopped
  }

  private func send(_ result: Result<(response: HTTPURLResponse, body: Data), Error>) {
    // Keep client calls outside both locks. A callback already admitted may finish as stop begins.
    guard !isStopped else { return }
    switch result {
    case .success(let value):
      client?.urlProtocol(self, didReceive: value.response, cacheStoragePolicy: .notAllowed)
      guard !isStopped else { return }
      client?.urlProtocol(self, didLoad: value.body)
      guard !isStopped else { return }
      client?.urlProtocolDidFinishLoading(self)
    case .failure(let error):
      client?.urlProtocol(self, didFailWithError: error)
    }
  }
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
  private var resources: TripPaintingMapQueuedResource?
  private var isRetiring = false

  var isBlocked: Bool {
    lock.lock()
    defer { lock.unlock() }
    return blocked
  }

  var isCacheOnly: Bool {
    lock.lock()
    defer { lock.unlock() }
    return blocked && resources == nil
  }

  func setBlocked(_ value: Bool) {
    lock.lock()
    blocked = value
    let previous = value ? nil : beginRetiringResources()
    lock.unlock()
    if let previous { finishRetiring(previous) }
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

  func registerActiveOperation(_ operation: TripPaintingMapQueuedResource) -> URL? {
    guard operation.canActivate else { return nil }
    let route = operation.route
    lock.lock()
    defer { lock.unlock() }
    guard blocked, !isRetiring, resources == nil || resources === operation,
          let address = registerStyleLocked(LocalStyle(url: route.styleURL, bytes: route.styleBytes, scope: route.scope))
    else { return nil }
    resources = operation
    return address
  }

  @discardableResult
  func unregisterActiveOperation(_ operation: TripPaintingMapQueuedResource) -> Bool {
    lock.lock()
    let previous = resources === operation ? beginRetiringResources() : nil
    lock.unlock()
    guard let previous else { return false }
    finishRetiring(previous)
    return true
  }

  func operation(for request: URLRequest) -> TripPaintingMapQueuedResource? {
    lock.lock()
    let active = blocked && !isRetiring ? resources : nil
    lock.unlock()
    guard let active, active.route.providerRequest(for: request) != nil else { return nil }
    return active
  }

  func isActive(_ operation: TripPaintingMapQueuedResource) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return blocked && !isRetiring && resources === operation
  }

  private func register(_ style: LocalStyle, requiresCacheOnly: Bool) -> URL? {
    lock.lock()
    defer { lock.unlock() }
    guard !isRetiring, !requiresCacheOnly || blocked else { return nil }
    return registerStyleLocked(style)
  }

  private func registerStyleLocked(_ style: LocalStyle) -> URL? {
    if let existing = registeredStyle {
      return existing.url == style.url && existing.scope == style.scope && existing.bytes == style.bytes ? existing.url : nil
    }
    registeredStyle = style
    return style.url
  }

  private func beginRetiringResources() -> TripPaintingMapQueuedResource? {
    guard let resources, !isRetiring else { return nil }
    isRetiring = true
    registeredStyle = nil
    return resources
  }

  private func finishRetiring(_ operation: TripPaintingMapQueuedResource) {
    operation.queue.async { [self] in
      operation.close(notifyingWith: URLError(.cancelled)) { [self] in
        lock.lock()
        resources = nil
        isRetiring = false
        lock.unlock()
      }
    }
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
