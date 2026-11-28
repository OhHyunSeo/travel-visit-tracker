import Foundation

@main
enum NativeMapHTTPExchangeProbe {
  private struct Input: Decodable {
    let scope: String
    let style: String
    let metadata: String
    let tile: URL
    let otherTile: URL
  }

  static func main() throws {
    let args = CommandLine.arguments
    let single = args.count == 4 && args[3] == "--single"
    guard args.count == 3 || single, let port = UInt16(args[1]), port >= 1024, let line = readLine() else {
      throw CocoaError(.fileReadCorruptFile)
    }
    let input = try JSONDecoder().decode(Input.self, from: Data(line.utf8))
    let directory = URL(fileURLWithPath: args[2], isDirectory: true)
    guard let scope = TripPaintingMapRequestScope.validatePrepared(input.scope, styleJSON: input.style,
                                                                    metadataJSON: input.metadata),
          let budget = TripPaintingMapRequestBudget(scope: scope, directory: directory, opening: .newOperation)
    else { throw CocoaError(.fileReadCorruptFile) }

    let driver = Driver(budget: budget, input: input, port: port, single: single)
    if single {
      driver.process("single")
      guard driver.completed.wait(timeout: .now() + 10) == .success else { throw URLError(.timedOut) }
      return
    }
    driver.process("start")
    while let command = readLine() { driver.process(command) }
  }

  private final class Driver {
    private let budget: TripPaintingMapRequestBudget
    private let input: Input
    private let port: UInt16
    private let single: Bool
    private let queue = DispatchQueue(label: "TripPaintingNativeMapHTTPExchangeFixture")
    private var exchanges = [Int: TripPaintingMapHTTPExchange]()
    private var firstPermit: TripPaintingMapRequestBudget.Permit?
    let completed = DispatchSemaphore(value: 0)

    init(budget: TripPaintingMapRequestBudget, input: Input, port: UInt16, single: Bool) {
      self.budget = budget
      self.input = input
      self.port = port
      self.single = single
    }

    func process(_ command: String) {
      queue.sync {
        switch command {
        case "single":
          emit("start", ["slot": start(1, for: input.tile)])
        case "start":
          emit("start", ["outside": start(0, for: input.otherTile),
                         "slots": (1...5).map { start($0, for: input.tile) }])
        case "replay":
          guard let firstPermit else { return emit("unexpected", [:]) }
          let replay = TripPaintingMapHTTPExchange(budget: budget, permit: firstPermit,
                                                   destination: .loopbackFixture(port),
                                                   queue: queue, timeout: 8) { [weak self] report in
            if case .failure(let error) = report.result {
              self?.emit("replay", ["error": String(describing: error), "sends": report.requestSends,
                                     "httpBytes": report.receivedHTTPBytes])
            } else {
              self?.emit("unexpected", [:])
            }
          }
          replay.start()
          emit("afterReplay", ["slot": start(5, for: input.tile)])
          budget.finish(firstPermit)
          emit("afterPrematureFinish", ["slot": start(5, for: input.tile)])
        case "cancel":
          exchanges[1]?.cancel()
          exchanges[1]?.cancel()
          emit("cancel", ["whileCancelling": start(5, for: input.tile)])
        case "retry":
          emit("retry", ["slot": start(5, for: input.tile)])
        default:
          emit("unexpected", [:])
        }
      }
    }

    private func start(_ number: Int, for logicalAddress: URL) -> String {
      var request = URLRequest(url: logicalAddress)
      request.setValue("Bearer fixture-only", forHTTPHeaderField: "Authorization")
      request.setValue("fixture-account=1", forHTTPHeaderField: "Cookie")
      request.setValue("fixture-proxy", forHTTPHeaderField: "Proxy-Authorization")
      request.setValue("fixture-device", forHTTPHeaderField: "X-Device-ID")
      request.setValue("fixture-account", forHTTPHeaderField: "X-Account-ID")
      request.setValue("fixture-agent", forHTTPHeaderField: "User-Agent")
      request.setValue("gzip", forHTTPHeaderField: "Accept-Encoding")
      let decision = budget.reserve(request, maximumBodyBytes: 256)
      switch decision {
      case .outsideScope: return "outside scope"
      case .busy: return "busy"
      case .exhausted: return "exhausted"
      case .invalidReservation, .unavailable: return "unavailable"
      case .reserved(let permit):
        if number == 1 { firstPermit = permit }
        let exchange = TripPaintingMapHTTPExchange(budget: budget, permit: permit,
                                                   destination: .loopbackFixture(port),
                                                   queue: queue, timeout: 8) { [weak self] report in
          guard let self, self.exchanges.removeValue(forKey: number) != nil else { return }
          if self.single { return self.reportSingle(report) }
          switch report.result {
          case .success(let (response, body)):
            let totalBytes = "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest".utf8.count
            precondition(response.url == logicalAddress && body == Data("test".utf8))
            precondition(report.receivedHTTPBytes == totalBytes)
            self.emit("terminal", ["slot": number, "sends": report.requestSends,
                                   "status": response.statusCode, "bytes": body.count, "failed": false])
          case .failure:
            precondition(report.receivedHTTPBytes == 0)
            self.emit("terminal", ["slot": number, "sends": report.requestSends,
                                   "status": 0, "bytes": 0, "failed": true])
          }
        }
        exchanges[number] = exchange
        exchange.start()
        exchange.start()
        return "started"
      }
    }

    private func reportSingle(_ report: TripPaintingMapHTTPExchange.Report) {
      var fields: [String: Any] = ["sends": report.requestSends, "httpBytes": report.receivedHTTPBytes]
      switch report.result {
      case .success(let (response, body)):
        fields["status"] = response.statusCode
        fields["bytes"] = body.count
      case .failure(let error):
        fields["error"] = String(describing: error)
        fields["bytes"] = 0
      }
      emit("terminal", fields)
      completed.signal()
    }

    private func emit(_ event: String, _ details: [String: Any]) {
      var payload = details
      payload["event"] = event
      let data = try! JSONSerialization.data(withJSONObject: payload)
      FileHandle.standardOutput.write(data + Data("\n".utf8))
    }
  }
}
