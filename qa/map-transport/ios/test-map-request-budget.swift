import Darwin
import Foundation

struct MapRequestBudgetProbe {
  struct Script: Decodable {
    struct Step: Decodable {
      enum Action: String, Decodable { case reserve, parallel, finish, reopen }
      let action: Action
      let address: String?
      let method: String?
      let bytes: Int?
      let count: Int?
      let name: String?
    }

    let scope: String
    let style: String
    let metadata: String
    let steps: [Step]
    let resume: Bool
  }

  struct Report: Encodable {
    let opened: Bool
    let events: [String]
  }

  static func run(_ data: Data, in directory: URL, hold: Bool) throws {
    let script = try JSONDecoder().decode(Script.self, from: data)
    let scope = TripPaintingMapRequestScope.validatePrepared(script.scope, styleJSON: script.style, metadataJSON: script.metadata)
    let budget = scope.flatMap { TripPaintingMapRequestBudget(scope: $0, directory: directory,
                                                              opening: script.resume ? .resumeOperation : .newOperation) }
    var events: [String] = []
    if let budget, let scope {
      events = runSteps(script.steps, budget: budget, scope: scope, directory: directory)
    }
    FileHandle.standardOutput.write(try JSONEncoder().encode(Report(opened: budget != nil, events: events)))
    FileHandle.standardOutput.write(Data("\n".utf8))
    if hold { withExtendedLifetime(budget) { _ = sleep(20) } }
  }

  private static func runSteps(_ steps: [Script.Step], budget: TripPaintingMapRequestBudget,
                               scope: TripPaintingMapRequestScope, directory: URL) -> [String] {
    var permits = [String: TripPaintingMapRequestBudget.Permit]()
    return steps.map { step in
      switch step.action {
      case .reserve:
        let decision = budget.reserve(makeRequest(step), maximumBodyBytes: step.bytes!)
        if case let .reserved(permit) = decision, let name = step.name { permits[name] = permit }
        return label(decision)
      case .parallel:
        let request = makeRequest(step)
        let results = ParallelResults()
        DispatchQueue.concurrentPerform(iterations: step.count!) { _ in
          results.append(label(budget.reserve(request, maximumBodyBytes: step.bytes!)))
        }
        return results.sortedLabels
      case .finish:
        budget.finish(permits[step.name!]!)
        return "finished"
      case .reopen:
        return TripPaintingMapRequestBudget(scope: scope, directory: directory, opening: .resumeOperation) == nil
          ? "already open" : "unexpected reopen"
      }
    }
  }

  private static func makeRequest(_ step: Script.Step) -> URLRequest {
    var request = URLRequest(url: URL(string: step.address!)!)
    request.httpMethod = step.method ?? "GET"
    return request
  }

  private static func label(_ decision: TripPaintingMapRequestBudget.Decision) -> String {
    switch decision {
    case .reserved(let permit): return "\(permit.kind.rawValue):\(permit.maximumBodyBytes)"
    case .outsideScope: return "outside scope"
    case .invalidReservation: return "invalid reservation"
    case .busy: return "busy"
    case .exhausted: return "exhausted"
    case .unavailable: return "unavailable"
    }
  }

  private final class ParallelResults: @unchecked Sendable {
    private let lock = NSLock()
    private var labels: [String] = []

    func append(_ label: String) {
      lock.lock()
      labels.append(label)
      lock.unlock()
    }

    var sortedLabels: String {
      lock.lock()
      defer { lock.unlock() }
      return labels.sorted().joined(separator: ",")
    }
  }
}
