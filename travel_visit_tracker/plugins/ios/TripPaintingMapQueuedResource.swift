import Foundation

/// Delivers a queued resource at the SDK's operation URL. Use on the request queue's serial queue.
final class TripPaintingMapQueuedResource: @unchecked Sendable {
  typealias Completion = @Sendable (Result<(response: HTTPURLResponse, body: Data), Error>) -> Void

  private struct Delivery {
    let requestID: UUID
    let url: URL
    let completion: Completion
  }

  let route: TripPaintingMapOperationRoute
  private let requests: TripPaintingMapRequestQueue
  let queue: DispatchQueue
  private let maximumBodyBytes: Int
  private var deliveries: [UUID: Delivery] = [:]
  private var closed = false

  init(route: TripPaintingMapOperationRoute, requests: TripPaintingMapRequestQueue,
       queue: DispatchQueue, maximumBodyBytes: Int) {
    self.route = route
    self.requests = requests
    self.queue = queue
    self.maximumBodyBytes = maximumBodyBytes
  }

  @discardableResult
  func start(_ request: URLRequest, completion: @escaping Completion) -> UUID? {
    guard canActivate,
          let url = request.url, let providerRequest = route.providerRequest(for: request)
    else { return nil }

    let id = UUID()
    let requestID = requests.enqueue(providerRequest, maximumBodyBytes: maximumBodyBytes) { [self] result in
      // The exchange may settle before the SDK cancels. Check ownership again at client delivery.
      queue.async { [self] in deliver(result, id: id) }
    }
    deliveries[id] = Delivery(requestID: requestID, url: url, completion: completion)
    return id
  }

  var canActivate: Bool {
    dispatchPrecondition(condition: .onQueue(queue))
    return !closed && requests.queue === queue && requests.scope == route.scope
      && (1...route.scope.limits.maxBodyBytes).contains(maximumBodyBytes)
  }

  func cancel(_ id: UUID) {
    dispatchPrecondition(condition: .onQueue(queue))
    guard let delivery = deliveries.removeValue(forKey: id) else { return }
    requests.cancel(delivery.requestID)
  }

  /// Close the operation's only resource adapter and request queue. Existing charges stay in the ledger.
  func close(notifyingWith error: Error? = nil, onDrained: (() -> Void)? = nil) {
    dispatchPrecondition(condition: .onQueue(queue))
    let bound = requests.queue === queue && requests.scope == route.scope
    if !closed {
      closed = true
      let waiting = error == nil ? [] : Array(deliveries.values)
      deliveries.removeAll()
      if bound { requests.close() }
      if let error {
        for delivery in waiting { delivery.completion(.failure(error)) }
      }
    }
    guard let onDrained else { return }
    if bound { requests.whenClosed(onDrained) } else { onDrained() }
  }

  private func deliver(_ result: Result<TripPaintingMapHTTPExchange.Report, TripPaintingMapRequestQueue.Failure>,
                       id: UUID) {
    guard let delivery = deliveries.removeValue(forKey: id) else { return }
    delivery.completion(Result {
      let reply = try result.get().result.get()
      guard let fields = reply.response.allHeaderFields as? [String: String],
            let response = HTTPURLResponse(url: delivery.url, statusCode: reply.response.statusCode,
                                           httpVersion: "HTTP/1.1", headerFields: fields)
      else { throw URLError(.cannotParseResponse) }
      return (response, reply.body)
    })
  }
}
