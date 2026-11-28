import Foundation

@main
struct BudgetTransportProbe {
  struct Input: Decodable {
    let scope: String
    let style: String
    let metadata: String
    let tile: URL
    let otherTile: URL
  }

  static func main() throws {
    let args = CommandLine.arguments
    guard args.count == 3, let port = UInt16(args[1]), port >= 1024, let line = readLine() else {
      throw CocoaError(.fileReadCorruptFile)
    }
    let input = try JSONDecoder().decode(Input.self, from: Data(line.utf8))
    let directory = URL(fileURLWithPath: args[2], isDirectory: true)
    guard let scope = TripPaintingMapRequestScope.validatePrepared(input.scope, styleJSON: input.style, metadataJSON: input.metadata),
          let budget = TripPaintingMapRequestBudget(scope: scope, directory: directory, opening: .newOperation)
    else { throw CocoaError(.fileReadCorruptFile) }

    let driver = Driver(budget: budget, input: input, port: port)
    driver.process("start")
    while let command = readLine() { driver.process(command) }
  }

  // Use the fixed loopback fixture. The validated provider addresses are only passed to the budget.
  private final class Driver {
    private let budget: TripPaintingMapRequestBudget
    private let input: Input
    private let port: UInt16
    private let queue = DispatchQueue(label: "TripPaintingRequestBudgetFixture")
    private var exchanges = [Int: TPHTTPExchange]()

    init(budget: TripPaintingMapRequestBudget, input: Input, port: UInt16) {
      self.budget = budget
      self.input = input
      self.port = port
    }

    func process(_ command: String) {
      queue.sync {
        switch command {
        case "start":
          emit("start", ["outside": start(0, for: input.otherTile),
                         "slots": (1...5).map { start($0, for: input.tile) }])
        case "cancel":
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
      let decision = budget.reserve(URLRequest(url: logicalAddress), maximumBodyBytes: Int(TPFixtureBodyLimit))
      switch decision {
      case .outsideScope: return "outside scope"
      case .busy: return "busy"
      case .exhausted: return "exhausted"
      case .invalidReservation, .unavailable: return "unavailable"
      case .reserved(let permit):
        let url = URL(string: "http://127.0.0.1:\(port)/resource/budget/\(number)")!
        let exchange = TPHTTPExchange(url: url, queue: queue, timeout: 8) { [weak self] response, body, error in
          guard let self, let exchange = self.exchanges.removeValue(forKey: number) else { return }
          self.budget.finish(permit)
          self.emit("terminal", ["slot": number, "sends": exchange.requestSendCount,
                                 "status": response?.statusCode ?? 0, "bytes": body?.count ?? 0,
                                 "failed": error != nil])
        }
        exchanges[number] = exchange
        exchange.start()
        return "started"
      }
    }

    private func emit(_ event: String, _ details: [String: Any]) {
      var payload = details
      payload["event"] = event
      let data = try! JSONSerialization.data(withJSONObject: payload)
      FileHandle.standardOutput.write(data + Data("\n".utf8))
    }
  }
}
