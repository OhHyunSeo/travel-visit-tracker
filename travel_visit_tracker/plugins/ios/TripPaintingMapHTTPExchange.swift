import Foundation
import Network
import Security

/// A single reserved GET on a fresh connection. Call start and cancel on the supplied serial queue.
final class TripPaintingMapHTTPExchange: @unchecked Sendable {
  enum Destination {
    case provider
    #if TP_MAP_TRANSPORT_FIXTURE
    case loopbackFixture(UInt16)
    #endif
  }

  struct Report {
    let result: Result<(response: HTTPURLResponse, body: Data), Error>
    let requestSends: Int
    let receivedHTTPBytes: Int
  }

  private enum Failure: Error { case invalidRequest, missingReservation, cancelled, timeout, unsupportedProtocol }
  private enum State { case idle, running, stopping, finished }
  private typealias ExchangeResult = Result<(response: HTTPURLResponse, body: Data), Error>

  private let budget: TripPaintingMapRequestBudget
  private let permit: TripPaintingMapRequestBudget.Permit
  private let destination: Destination
  private let queue: DispatchQueue
  private let timeout: TimeInterval
  private var completion: ((Report) -> Void)?
  private var state: State = .idle
  private var connection: NWConnection?
  private var timer: DispatchSourceTimer?
  private var claim: TripPaintingMapRequestBudget.ExchangeClaim?
  private var terminalResult: ExchangeResult?
  private var requestSends = 0
  private var receivedHTTPBytes = 0
  private var parser: TripPaintingMapHTTPResponse

  init(budget: TripPaintingMapRequestBudget, permit: TripPaintingMapRequestBudget.Permit,
       destination: Destination, queue: DispatchQueue, timeout: TimeInterval,
       completion: @escaping (Report) -> Void) {
    self.budget = budget
    self.permit = permit
    self.destination = destination
    self.queue = queue
    self.timeout = timeout
    self.completion = completion
    parser = TripPaintingMapHTTPResponse(maximumBodyBytes: permit.maximumBodyBytes)
  }

  func start() {
    dispatchPrecondition(condition: .onQueue(queue))
    guard state == .idle else { return }
    guard let claim = budget.claimForExchange(permit) else {
      budget.finish(permit)
      return settle(.failure(Failure.missingReservation))
    }
    self.claim = claim
    guard (0.05...30).contains(timeout), let request = requestBytes(), let connection = makeConnection()
    else { return settle(.failure(Failure.invalidRequest)) }

    state = .running
    self.connection = connection
    connection.stateUpdateHandler = { [self] status in onConnectionState(status, request: request) }
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + timeout)
    timer.setEventHandler { [weak self] in self?.stop(.failure(Failure.timeout)) }
    self.timer = timer
    timer.resume()
    connection.start(queue: queue)
  }

  func cancel() {
    dispatchPrecondition(condition: .onQueue(queue))
    if state == .idle {
      budget.finish(permit)
      settle(.failure(Failure.cancelled))
    } else if state == .running {
      stop(.failure(Failure.cancelled))
    } else if case .success? = terminalResult {
      terminalResult = .failure(Failure.cancelled)
    }
  }

  private func requestBytes() -> Data? {
    guard let parts = URLComponents(url: permit.url, resolvingAgainstBaseURL: false),
          parts.scheme == "https", parts.host == "tiles.openfreemap.org", parts.port == nil,
          parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
          parts.percentEncodedPath.hasPrefix("/"), parts.percentEncodedPath.utf8.count <= 512,
          parts.percentEncodedPath.utf8.allSatisfy({ (33...126).contains($0) })
    else { return nil }
    // Rebuild from the permit instead of forwarding SDK headers, account data, or connection state.
    return Data(("GET \(parts.percentEncodedPath) HTTP/1.1\r\n"
      + "Host: tiles.openfreemap.org\r\n"
      + "User-Agent: TripPaintingOfflineMaps (+https://github.com/OhHyunSeo/travel-visit-tracker)\r\n"
      + "Accept-Encoding: identity\r\nConnection: close\r\n\r\n").utf8)
  }

  private func makeConnection() -> NWConnection? {
    switch destination {
    case .provider:
      guard #available(macOS 15.5, iOS 18.5, *) else { return nil }
      let tls = NWProtocolTLS.Options()
      let options = tls.securityProtocolOptions
      sec_protocol_options_set_tls_server_name(options, "tiles.openfreemap.org")
      sec_protocol_options_set_min_tls_protocol_version(options, .TLSv12)
      sec_protocol_options_set_peer_authentication_required(options, true)
      sec_protocol_options_set_tls_resumption_enabled(options, false)
      sec_protocol_options_set_tls_tickets_enabled(options, false)
      sec_protocol_options_set_tls_false_start_enabled(options, false)
      sec_protocol_options_add_tls_application_protocol(options, "http/1.1")
      return NWConnection(host: "tiles.openfreemap.org", port: .https,
                          using: NWParameters(tls: tls, tcp: NWProtocolTCP.Options()))
    #if TP_MAP_TRANSPORT_FIXTURE
    case .loopbackFixture(let port):
      guard port >= 1024, let endpointPort = NWEndpoint.Port(rawValue: port) else { return nil }
      return NWConnection(host: "127.0.0.1", port: endpointPort, using: .tcp)
    #endif
    }
  }

  private func negotiatedHTTP11(_ connection: NWConnection) -> Bool {
    switch destination {
    case .provider:
      guard #available(macOS 15.5, iOS 18.5, *),
            let metadata = connection.metadata(definition: NWProtocolTLS.definition) as? NWProtocolTLS.Metadata,
            let selected = sec_protocol_metadata_copy_negotiated_protocol(metadata.securityProtocolMetadata)
      else { return false }
      defer { free(UnsafeMutableRawPointer(mutating: selected)) }
      return String(cString: selected) == "http/1.1"
    #if TP_MAP_TRANSPORT_FIXTURE
    case .loopbackFixture: return true
    #endif
    }
  }

  private func onConnectionState(_ status: NWConnection.State, request: Data) {
    if case .cancelled = status {
      settle(terminalResult ?? .failure(Failure.cancelled))
      return
    }
    guard state == .running else { return }
    switch status {
    case .ready:
      guard requestSends == 0, let connection else { return }
      guard negotiatedHTTP11(connection) else { return stop(.failure(Failure.unsupportedProtocol)) }
      requestSends = 1
      connection.send(content: request, contentContext: .defaultMessage, isComplete: true,
                      completion: .contentProcessed { [self] error in
        guard state == .running else { return }
        if let error { stop(.failure(error)) } else { receive() }
      })
    case .failed(let error), .waiting(let error): stop(.failure(error))
    default: break
    }
  }

  private func receive() {
    connection?.receive(minimumIncompleteLength: 1, maximumLength: parser.nextReadLimit) { [self] data, _, ended, error in
      guard state == .running else { return }
      do {
        if let data {
          receivedHTTPBytes += data.count
          try parser.append(data)
        }
        if let error { return stop(.failure(error)) }
        if ended { return stop(.success(try parser.finish(at: permit.url))) }
        receive()
      } catch {
        stop(.failure(error))
      }
    }
  }

  private func stop(_ result: ExchangeResult) {
    guard state == .running else { return }
    state = .stopping
    terminalResult = result
    // The terminal state callback releases the permit even when cancelling a held response.
    connection?.cancel()
  }

  private func settle(_ result: ExchangeResult) {
    guard state != .finished else { return }
    state = .finished
    timer?.cancel()
    timer = nil
    connection?.stateUpdateHandler = nil
    connection = nil
    if let claim { budget.finish(claim) }
    claim = nil
    let callback = completion
    completion = nil
    terminalResult = nil
    parser = TripPaintingMapHTTPResponse(maximumBodyBytes: permit.maximumBodyBytes)
    callback?(Report(result: result, requestSends: requestSends, receivedHTTPBytes: receivedHTTPBytes))
  }
}
