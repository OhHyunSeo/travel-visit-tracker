import Foundation

/// Owns one validated operation's budget and exchanges. Call its methods on the supplied serial
/// queue. Completions run asynchronously on that same queue, including immediate denials.
/// A cancellation can change an active result until the connection settles on that queue.
final class TripPaintingMapRequestQueue: @unchecked Sendable {
  enum Failure: Error, Equatable {
    case outsideScope, invalidReservation, queueFull, exhausted, unavailable, cancelled, closed
  }

  private static let maximumPending = 64
  private typealias Completion = @Sendable (Result<TripPaintingMapHTTPExchange.Report, Failure>) -> Void

  private struct Work {
    let id: UUID
    let maximumBodyBytes: Int
    let completion: Completion
  }

  private struct Pending {
    let request: URLRequest
    let work: Work
  }

  private struct Active {
    let exchange: TripPaintingMapHTTPExchange
    var cancelled = false
  }

  private let budget: TripPaintingMapRequestBudget
  private let destination: TripPaintingMapHTTPExchange.Destination
  let scope: TripPaintingMapRequestScope
  let queue: DispatchQueue
  private let timeout: TimeInterval
  private var pending: [Pending] = []
  private var active: [UUID: Active] = [:]
  private var closed = false
  private var draining = false
  private var closeCallbacks: [() -> Void] = []
  #if TP_MAP_TRANSPORT_FIXTURE
  var fixtureDidSettle: ((UUID, TripPaintingMapHTTPExchange.Report) -> Void)?
  var fixturePendingCount: Int {
    dispatchPrecondition(condition: .onQueue(queue))
    return pending.count
  }
  #endif

  init?(scope: TripPaintingMapRequestScope, directory: URL, opening: TripPaintingMapRequestBudget.Opening,
        destination: TripPaintingMapHTTPExchange.Destination, queue: DispatchQueue, timeout: TimeInterval) {
    guard (0.05...30).contains(timeout),
          let budget = TripPaintingMapRequestBudget(scope: scope, directory: directory, opening: opening)
    else { return nil }
    self.budget = budget
    self.destination = destination
    self.scope = scope
    self.queue = queue
    self.timeout = timeout
  }

  @discardableResult
  func enqueue(_ request: URLRequest, maximumBodyBytes: Int,
               completion: @escaping @Sendable (Result<TripPaintingMapHTTPExchange.Report, Failure>) -> Void) -> UUID {
    dispatchPrecondition(condition: .onQueue(queue))
    let work = Work(id: UUID(), maximumBodyBytes: maximumBodyBytes, completion: completion)
    guard !closed else {
      deliver(.failure(.closed), to: work)
      return work.id
    }

    // The budget checks scope and body limits before reporting busy. Retain only a validated GET's
    // URL while it waits, with no caller-supplied headers or other request state.
    let decision = budget.reserve(request, maximumBodyBytes: maximumBodyBytes)
    if case .busy = decision {
      if pending.count >= Self.maximumPending {
        deliver(.failure(.queueFull), to: work)
      } else if let url = request.url {
        pending.append(Pending(request: URLRequest(url: url), work: work))
      } else {
        deliver(.failure(.outsideScope), to: work)
      }
    } else {
      dispatch(decision, work: work)
    }
    return work.id
  }

  func cancel(_ id: UUID) {
    dispatchPrecondition(condition: .onQueue(queue))
    if let index = pending.firstIndex(where: { $0.work.id == id }) {
      deliver(.failure(.cancelled), to: pending.remove(at: index).work)
    } else if let exchange = active[id]?.exchange, active[id]?.cancelled == false {
      active[id]?.cancelled = true
      exchange.cancel()
    }
  }

  func close() {
    dispatchPrecondition(condition: .onQueue(queue))
    guard !closed else { return }
    closed = true
    let waiting = pending
    pending.removeAll()
    for entry in waiting { deliver(.failure(.cancelled), to: entry.work) }
    for id in Array(active.keys) { cancel(id) }
  }

  func whenClosed(_ callback: @escaping () -> Void) {
    dispatchPrecondition(condition: .onQueue(queue))
    precondition(closed)
    closeCallbacks.append(callback)
    finishClosing()
  }

  private func finishClosing() {
    guard closed, active.isEmpty else { return }
    let callbacks = closeCallbacks
    closeCallbacks.removeAll()
    for callback in callbacks { callback() }
  }

  private func drain() {
    guard !closed, !draining else { return }
    draining = true
    defer { draining = false }
    while let entry = pending.first {
      let decision = budget.reserve(entry.request, maximumBodyBytes: entry.work.maximumBodyBytes)
      if case .busy = decision { return }
      pending.removeFirst()
      dispatch(decision, work: entry.work)
    }
  }

  private func dispatch(_ decision: TripPaintingMapRequestBudget.Decision, work: Work) {
    switch decision {
    case .reserved(let permit):
      let exchange = TripPaintingMapHTTPExchange(budget: budget, permit: permit, destination: destination,
                                                 queue: queue, timeout: timeout) { [self] report in
        guard let finished = active.removeValue(forKey: work.id) else { return }
        deliver(finished.cancelled ? .failure(.cancelled) : .success(report), to: work)
        #if TP_MAP_TRANSPORT_FIXTURE
        fixtureDidSettle?(work.id, report)
        #endif
        // The exchange has returned its claimed slot after its terminal callback.
        drain()
        finishClosing()
      }
      active[work.id] = Active(exchange: exchange)
      exchange.start()
    case .outsideScope: deliver(.failure(.outsideScope), to: work)
    case .invalidReservation: deliver(.failure(.invalidReservation), to: work)
    case .exhausted: deliver(.failure(.exhausted), to: work)
    case .unavailable, .busy: deliver(.failure(.unavailable), to: work)
    }
  }

  private func deliver(_ result: Result<TripPaintingMapHTTPExchange.Report, Failure>, to work: Work) {
    queue.async { work.completion(result) }
  }
}
