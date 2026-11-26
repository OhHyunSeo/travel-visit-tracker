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
  }

  private struct RoutedRequest: Decodable {
    let number: Int
    let address: URL
    let method: String?
    let body: String?
  }

  static func main() throws {
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
    }
  }

  private final class Driver: @unchecked Sendable {
    private let queue: DispatchQueue
    private let requests: TripPaintingMapRequestQueue
    private let ledger: URL
    private let input: Input
    private lazy var route = TripPaintingMapOperationRoute(scopeJSON: input.scope, styleJSON: input.style,
                                                           metadataJSON: input.saved)
    private var identifiers: [Int: UUID] = [:]

    init?(scope: TripPaintingMapRequestScope, directory: URL, port: UInt16, input: Input) {
      let queue = DispatchQueue(label: "TripPaintingNativeMapRequestQueueFixture")
      guard let requests = TripPaintingMapRequestQueue(scope: scope, directory: directory, opening: .newOperation,
                                                       destination: .loopbackFixture(port), queue: queue, timeout: 20)
      else { return nil }
      self.queue = queue
      self.requests = requests
      self.input = input
      ledger = directory.appendingPathComponent("request-budget-v1.sqlite")
    }

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
