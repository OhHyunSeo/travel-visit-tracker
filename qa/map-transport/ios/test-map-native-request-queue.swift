import Foundation
import SQLite3

@main
enum NativeMapRequestQueueProbe {
  private struct Input: Decodable {
    let scope: String
    let style: String
    let saved: String
    let tiles: [URL]
  }

  private struct Command: Decodable {
    let add: [Int]?
    let cancel: Int?
    let close: Bool?
    let bytes: Int?
    let outsideScope: Bool?
    let describeRoute: Bool?
    let routedRequest: RoutedRequest?
    let blockStyleRequests: Bool?
    let registerOperationStyle: Bool?
    let fetchStyle: URL?
    let registerActiveOperation: Bool?
    let unregisterActiveOperation: Bool?
    let watchReplacementOperation: String?
    let startSessionRequests: [RoutedRequest]?
    let cancelSessionRequest: Int?
    let inspectPendingRequests: Bool?
    let startResources: [RoutedRequest]?
    let cancelResource: Int?
    let cancelResourceAtTerminal: Int?
    let closeResourcesAtTerminal: Int?
    let checkResourceContext: ResourceContext?
  }

  private struct RoutedRequest: Decodable {
    let number: Int
    let address: URL
    let method: String?
    let body: String?
  }

  private struct ResourceContext: Decodable {
    let address: URL
    let otherOperationID: String?
  }

  static func main() async throws {
    let args = CommandLine.arguments
    let decoder = JSONDecoder()
    guard args.count == 3, let port = UInt16(args[1]), port >= 1024, let line = readLine() else {
      throw CocoaError(.fileReadCorruptFile)
    }
    let input = try decoder.decode(Input.self, from: Data(line.utf8))
    let directory = URL(fileURLWithPath: args[2], isDirectory: true)
    guard !input.tiles.isEmpty,
          let scope = TripPaintingMapRequestScope.validatePrepared(input.scope, styleJSON: input.style,
                                                                   metadataJSON: input.saved),
          let driver = Driver(scope: scope, directory: directory, port: port, input: input)
    else { throw CocoaError(.fileReadCorruptFile) }

    while let line = readLine() {
      let command = try decoder.decode(Command.self, from: Data(line.utf8))
      driver.process(command)
      if let url = command.fetchStyle { await driver.fetchStyle(url) }
    }
  }

  // Fail with a distinct error if the tested guard leaves a request unhandled.
  private final class NoNetworkFallback: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
      client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
    }

    override func stopLoading() {}
  }

  private final class Driver: @unchecked Sendable {
    private let queue: DispatchQueue
    private let requests: TripPaintingMapRequestQueue
    private let ledger: URL
    private let port: UInt16
    private let input: Input
    private lazy var route = TripPaintingMapOperationRoute(scopeJSON: input.scope, styleJSON: input.style,
                                                           metadataJSON: input.saved)
    private var identifiers: [Int: UUID] = [:]
    private let session: URLSession
    private var sessionTasks: [Int: URLSessionDataTask] = [:]
    private lazy var routedResources = route.map {
      TripPaintingMapQueuedResource(route: $0, requests: requests, queue: queue, maximumBodyBytes: 256)
    }
    private var resourceIdentifiers: [Int: UUID] = [:]

    init?(scope: TripPaintingMapRequestScope, directory: URL, port: UInt16, input: Input) {
      let queue = DispatchQueue(label: "TripPaintingNativeMapRequestQueueFixture")
      guard let requests = TripPaintingMapRequestQueue(scope: scope, directory: directory, opening: .newOperation,
                                                       destination: .loopbackFixture(port), queue: queue, timeout: 20)
      else { return nil }
      self.queue = queue
      self.requests = requests
      self.input = input
      self.port = port
      ledger = directory.appendingPathComponent("request-budget-v1.sqlite")
      let configuration = URLSessionConfiguration.ephemeral
      configuration.protocolClasses = [OfflineMapRequestGuard.self, NoNetworkFallback.self]
      configuration.httpMaximumConnectionsPerHost = 12
      configuration.timeoutIntervalForRequest = 10
      session = URLSession(configuration: configuration)
    }

    deinit { session.invalidateAndCancel() }

    func process(_ command: Command) {
      queue.sync {
        for number in command.add ?? [] {
          enqueue(number, bytes: command.bytes ?? 256, outsideScope: command.outsideScope ?? false)
        }
        if command.describeRoute == true, let route {
          emit("route", ["styleURL": route.styleURL.absoluteString,
                         "style": String(decoding: route.styleBytes, as: UTF8.self)])
        }
        if let routed = command.routedRequest { routeRequest(routed) }
        for resource in command.startResources ?? [] { startResource(resource) }
        if let number = command.cancelResource { cancelResource(number) }
        if let number = command.cancelResourceAtTerminal { cancelResourceAtTerminal(number) }
        if let active = command.closeResourcesAtTerminal { closeResourcesAtTerminal(active) }
        if let context = command.checkResourceContext { checkResourceContext(context) }
        if let blocked = command.blockStyleRequests { OfflineMapRequestGuard.policy.setBlocked(blocked) }
        if command.registerOperationStyle == true {
          let address = route.flatMap { OfflineMapRequestGuard.policy.registerOperationStyle($0) }
          emit("registeredStyle", ["address": address.map { $0.absoluteString as Any } ?? NSNull()])
        }
        if command.registerActiveOperation == true {
          let address = routedResources.flatMap { OfflineMapRequestGuard.policy.registerActiveOperation($0) }
          emit("registeredActiveOperation", ["address": address.map { $0.absoluteString as Any } ?? NSNull()])
        }
        if let operationID = command.watchReplacementOperation { watchReplacementOperation(operationID) }
        if command.unregisterActiveOperation == true {
          let removed = routedResources.map { OfflineMapRequestGuard.policy.unregisterActiveOperation($0) } ?? false
          emit("unregisteredActiveOperation", ["removed": removed])
        }
        for resource in command.startSessionRequests ?? [] { startSessionRequest(resource) }
        if let number = command.cancelSessionRequest, let task = sessionTasks[number] {
          task.cancel()
          task.cancel()
        }
        if command.inspectPendingRequests == true {
          emit("pendingRequests", ["count": requests.fixturePendingCount])
        }
        if let number = command.cancel, let id = identifiers[number] {
          requests.cancel(id)
          requests.cancel(id)
        }
        if command.close == true {
          requests.close()
          requests.close()
        }
        // A terminal connection callback cannot run during this serial turn.
        emit("checkpoint", ["charges": readCharges()])
      }
    }

    private func watchReplacementOperation(_ operationID: String) {
      guard let old = routedResources else { preconditionFailure("missing old resources") }
      let replacementRoute = route(replacingOperationID: operationID)
      let directory = ledger.deletingLastPathComponent().appendingPathComponent("replacement", isDirectory: true)
      try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
      let replacementQueue = TripPaintingMapRequestQueue(scope: replacementRoute.scope, directory: directory,
                                                         opening: .newOperation, destination: .loopbackFixture(port),
                                                         queue: queue, timeout: 20)!
      let replacement = TripPaintingMapQueuedResource(route: replacementRoute, requests: replacementQueue,
                                                     queue: queue, maximumBodyBytes: 256)
      let policy = OfflineMapRequestGuard.policy
      let expectedTerminals = requests.scope.limits.maxConcurrentRequests
      var terminals = 0
      requests.fixtureDidSettle = { [weak self] _, _ in
        guard let self else { return }
        terminals += 1
        if terminals == 1 {
          let admitted = policy.registerActiveOperation(replacement)
          self.emit("replacementWhileRetiring", ["admitted": admitted != nil])
        }
        if terminals == expectedTerminals {
          self.requests.fixtureDidSettle = nil
          self.queue.async {
            let oldAddress = policy.registerActiveOperation(old)
            let newAddress = policy.registerActiveOperation(replacement)
            self.emit("replacementAfterRetirement", ["settled": expectedTerminals,
                                                     "oldAdmitted": oldAddress != nil,
                                                     "newAddress": newAddress.map { $0.absoluteString as Any } ?? NSNull()])
          }
        }
      }
    }

    private func startSessionRequest(_ resource: RoutedRequest) {
      let number = resource.number
      precondition(resource.address.scheme == "https"
        && [TripPaintingMapOperationRoute.host, "tiles.openfreemap.org"].contains(resource.address.host))
      precondition(sessionTasks[number] == nil)
      var request = request(for: resource.address)
      request.httpMethod = resource.method ?? "GET"
      if let body = resource.body { request.httpBody = Data(body.utf8) }
      let task = session.dataTask(with: request) { [weak self] body, response, error in
        guard let self else { return }
        self.queue.async {
          precondition(self.sessionTasks.removeValue(forKey: number) != nil)
          var fields: [String: Any] = ["number": number, "bodyBytes": body?.count ?? 0]
          if let response = response as? HTTPURLResponse {
            fields["address"] = response.url?.absoluteString
            fields["status"] = response.statusCode
            fields["length"] = response.value(forHTTPHeaderField: "Content-Length")
          }
          if let body { fields["body"] = String(decoding: body, as: UTF8.self) }
          if let error = error as NSError? {
            fields["errorDomain"] = error.domain
            fields["errorCode"] = error.code
          }
          self.emit("sessionResult", fields)
        }
      }
      sessionTasks[number] = task
      task.resume()
      emit("sessionStarted", ["number": number])
    }

    private func startResource(_ resource: RoutedRequest) {
      let number = resource.number
      precondition(number > 0 && resourceIdentifiers[number] == nil)
      var request = request(for: resource.address)
      request.httpMethod = resource.method ?? "GET"
      if let body = resource.body { request.httpBody = Data(body.utf8) }
      let id = routedResources?.start(request) { [weak self] result in
        guard let self else { return }
        self.resourceIdentifiers.removeValue(forKey: number)
        var fields: [String: Any] = ["number": number]
        switch result {
        case .success(let (response, body)):
          fields["address"] = response.url?.absoluteString
          fields["status"] = response.statusCode
          fields["length"] = response.value(forHTTPHeaderField: "Content-Length")
          fields["body"] = String(decoding: body, as: UTF8.self)
        case .failure(let error):
          fields["error"] = String(describing: error)
        }
        self.emit("resourceResult", fields)
      }
      resourceIdentifiers[number] = id
      emit("resourceStart", ["number": number, "accepted": id != nil])
    }

    private func cancelResource(_ number: Int) {
      guard let id = resourceIdentifiers.removeValue(forKey: number) else { return }
      routedResources?.cancel(id)
      routedResources?.cancel(id)
    }

    private func cancelResourceAtTerminal(_ number: Int) {
      precondition(resourceIdentifiers[number] != nil)
      requests.fixtureDidSettle = { [weak self] _, report in
        guard let self else { return }
        self.requests.fixtureDidSettle = nil
        let reply = try! report.result.get()
        self.cancelResource(number)
        self.emit("resourceTransportTerminal", ["number": number, "sends": report.requestSends,
                                                "status": reply.response.statusCode, "bytes": reply.body.count])
        // The queue callback is already enqueued, and may queue a second consumer-delivery turn.
        self.queue.async { self.queue.async { self.emit("resourceDeliveryDrained", ["number": number]) } }
      }
    }

    private func closeResourcesAtTerminal(_ active: Int) {
      precondition(active > 0 && resourceIdentifiers.count >= active)
      var terminals = 0
      var sends = 0
      requests.fixtureDidSettle = { [weak self] _, report in
        guard let self else { return }
        terminals += 1
        sends += report.requestSends
        if terminals == 1 {
          let reply = try! report.result.get()
          guard let resources = self.routedResources else { preconditionFailure("missing fixture resources") }
          resources.close()
          resources.close()
          self.emit("resourceClosedAtTerminal", ["status": reply.response.statusCode, "bytes": reply.body.count,
                                                 "charges": self.readCharges()])
        }
        if terminals == active {
          self.requests.fixtureDidSettle = nil
          let observedSends = sends
          self.queue.async {
            self.queue.async { self.emit("resourceCloseDrained", ["active": active, "sends": observedSends]) }
          }
        }
      }
    }

    private func checkResourceContext(_ context: ResourceContext) {
      guard let route else { preconditionFailure("missing fixture route") }
      let alternateQueue = DispatchQueue(label: "TripPaintingNativeMapResourceWrongQueueFixture")
      let startQueue: DispatchQueue
      let resourceRoute: TripPaintingMapOperationRoute
      if let otherID = context.otherOperationID {
        startQueue = queue
        resourceRoute = self.route(replacingOperationID: otherID)
      } else {
        startQueue = alternateQueue
        resourceRoute = route
      }
      let resource = TripPaintingMapQueuedResource(route: resourceRoute, requests: requests,
                                                  queue: startQueue, maximumBodyBytes: 256)
      let request = request(for: context.address)
      precondition(resourceRoute.providerRequest(for: request) != nil)
      let completion: TripPaintingMapQueuedResource.Completion = { [weak self] _ in
        self?.emit("unexpectedResourceResult", [:])
      }
      let start = { resource.start(request, completion: completion) }
      let id = startQueue === queue ? start() : alternateQueue.sync(execute: start)
      emit("resourceContext", ["accepted": id != nil])
    }

    private func route(replacingOperationID operationID: String) -> TripPaintingMapOperationRoute {
      guard let oldID = route?.scope.operationId,
            let replacement = TripPaintingMapOperationRoute(
              scopeJSON: input.scope.replacingOccurrences(of: oldID, with: operationID), styleJSON: input.style,
              metadataJSON: input.saved.replacingOccurrences(of: oldID, with: operationID))
      else { preconditionFailure("missing replacement route") }
      return replacement
    }

    func fetchStyle(_ address: URL) async {
      precondition(address.scheme == "https" && address.host == TripPaintingMapOperationRoute.host)
      do {
        let (body, response) = try await session.data(from: address)
        guard let response = response as? HTTPURLResponse else { preconditionFailure("missing style response") }
        emit("styleResult", ["address": response.url.map { $0.absoluteString as Any } ?? NSNull(),
                             "status": response.statusCode,
                             "length": response.value(forHTTPHeaderField: "Content-Length").map { $0 as Any } ?? NSNull(),
                             "mimeType": response.mimeType.map { $0 as Any } ?? NSNull(),
                             "body": String(decoding: body, as: UTF8.self)])
      } catch {
        let error = error as NSError
        emit("styleResult", ["errorDomain": error.domain, "errorCode": error.code])
      }
    }

    private func enqueue(_ number: Int, bytes: Int, outsideScope: Bool) {
      let tile = input.tiles[(number - 1) % input.tiles.count]
      let address = outsideScope ? tile.appending(queryItems: [URLQueryItem(name: "fixture", value: "outside")]) : tile
      enqueue(request(for: address), number: number, bytes: bytes)
    }

    private func routeRequest(_ routed: RoutedRequest) {
      var request = request(for: routed.address)
      request.httpMethod = routed.method ?? "GET"
      if let body = routed.body { request.httpBody = Data(body.utf8) }
      guard let providerRequest = route?.providerRequest(for: request) else {
        emit("routeRejected", ["number": routed.number])
        return
      }
      enqueue(providerRequest, number: routed.number, bytes: 256)
    }

    private func request(for address: URL) -> URLRequest {
      var request = URLRequest(url: address)
      request.setValue("Bearer fixture-only", forHTTPHeaderField: "Authorization")
      request.setValue("fixture-account=1", forHTTPHeaderField: "Cookie")
      return request
    }

    private func enqueue(_ request: URLRequest, number: Int, bytes: Int) {
      precondition(number > 0 && identifiers[number] == nil)
      let address = request.url
      identifiers[number] = requests.enqueue(request, maximumBodyBytes: bytes) { [weak self] result in
        guard let self else { return }
        precondition(self.identifiers.removeValue(forKey: number) != nil)
        var fields: [String: Any] = ["number": number]
        switch result {
        case .failure(let error):
          fields["error"] = String(describing: error)
        case .success(let report):
          fields["sends"] = report.requestSends
          switch report.result {
          case .success(let (response, body)):
            precondition(response.url == address)
            fields["status"] = response.statusCode
            fields["body"] = String(decoding: body, as: UTF8.self)
          case .failure(let error):
            fields["error"] = String(describing: error)
          }
        }
        self.emit("terminal", fields)
      }
    }

    private func readCharges() -> [Int] {
      var database: OpaquePointer?
      precondition(sqlite3_open_v2(ledger.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK)
      defer { sqlite3_close(database) }
      var statement: OpaquePointer?
      precondition(sqlite3_prepare_v2(database, "SELECT tile_attempts, reserved_bytes FROM request_budget",
                                     -1, &statement, nil) == SQLITE_OK)
      defer { sqlite3_finalize(statement) }
      precondition(sqlite3_step(statement) == SQLITE_ROW)
      return [Int(sqlite3_column_int64(statement, 0)), Int(sqlite3_column_int64(statement, 1))]
    }

    private func emit(_ event: String, _ details: [String: Any]) {
      var payload = details
      payload["event"] = event
      let data = try! JSONSerialization.data(withJSONObject: payload)
      FileHandle.standardOutput.write(data + Data("\n".utf8))
    }
  }
}
