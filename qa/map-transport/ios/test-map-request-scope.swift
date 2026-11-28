import Foundation

@main
struct ScopeProbe {
  struct Case: Decodable {
    struct Request: Decodable {
      let address: String
      let method: String
    }
    let scope: String
    let style: String
    let metadata: String?
    let requests: [Request]
  }

  struct Result: Encodable {
    let accepted: Bool
    let resources: [String?]
  }

  static func main() async throws {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    if let budgetArgument = CommandLine.arguments.firstIndex(of: "--request-budget") {
      try MapRequestBudgetProbe.run(data, in: URL(fileURLWithPath: CommandLine.arguments[budgetArgument + 1]),
                                    hold: CommandLine.arguments.contains("--hold"))
      return
    }
    let cases = try JSONDecoder().decode([Case].self, from: data)
    if CommandLine.arguments.contains("--local-style") {
      try await runLocalStyleProbe(cases)
      return
    }
    let results = cases.map { item in
      let scope = if let metadata = item.metadata {
        TripPaintingMapRequestScope.validatePrepared(item.scope, styleJSON: item.style, metadataJSON: metadata)
      } else {
        TripPaintingMapRequestScope.validate(item.scope, styleJSON: item.style)
      }
      return Result(accepted: scope != nil, resources: item.requests.map {
        scope?.resourceKind(for: $0.address, method: $0.method)?.rawValue
      })
    }
    FileHandle.standardOutput.write(try JSONEncoder().encode(results))
  }

  private static func runLocalStyleProbe(_ cases: [Case]) async throws {
    let item = cases[0]
    let policy = OfflineMapRequestGuard.policy
    let scope = TripPaintingMapRequestScope.validatePrepared(item.scope, styleJSON: item.style, metadataJSON: item.metadata!)!
    let address = "https://offline-style.trip-painting.invalid/v1/\(scope.operationId)/\(scope.localStyleSha256).json"
    let request = URLRequest(url: URL(string: address)!)
    let external = URLRequest(url: URL(string: "https://unrelated.invalid/map")!)
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [OfflineMapRequestGuard.self]
    let session = URLSession(configuration: configuration)
    defer { session.invalidateAndCancel() }

    var report = [String: Bool]()
    report["reservedHostInterceptedWhenUnblocked"] = OfflineMapRequestGuard.canInit(with: request)
    report["otherRequestsUnaffectedWhenUnblocked"] = !OfflineMapRequestGuard.canInit(with: external)
    report["unregisteredStyleDenied"] = await denied(request, in: session)
    policy.setBlocked(true)
    report["externalStillBlocked"] = await denied(external, in: session)
    let before = policy.registerStyle(item.scope, styleJSON: item.style + " ", metadataJSON: item.metadata!)
    report["changedBytesAreDenied"] = before == nil
    let url = policy.registerStyle(item.scope, styleJSON: item.style, metadataJSON: item.metadata!)
    report["exactAddress"] = url?.absoluteString == address
    let recovered = OfflineMapRequestPolicy().registerStyle(item.scope, styleJSON: item.style, metadataJSON: item.metadata!)
    report["recoveredAddressMatches"] = url == recovered
    report["repeatRegistrationMatches"] = url == policy.registerStyle(item.scope, styleJSON: item.style, metadataJSON: item.metadata!)
    let other = cases[1]
    report["validDifferentPlanCannotReplaceStyle"] = TripPaintingMapRequestScope.validatePrepared(other.scope, styleJSON: other.style, metadataJSON: other.metadata!) != nil
      && policy.registerStyle(other.scope, styleJSON: other.style, metadataJSON: other.metadata!) == nil
    let (body, response) = try await session.data(for: request)
    report["onlyValidatedBytesServed"] = (response as? HTTPURLResponse)?.statusCode == 200
      && response.mimeType == "application/json" && body == Data(item.style.utf8)
    report["remainsCacheOnly"] = policy.isBlocked

    for input in item.requests {
      var bad = URLRequest(url: URL(string: input.address)!)
      bad.httpMethod = input.method
      report["denied:\(input.method):\(input.address)"] = await denied(bad, in: session)
    }
    FileHandle.standardOutput.write(try JSONEncoder().encode(report))
  }

  private static func denied(_ request: URLRequest, in session: URLSession) async -> Bool {
    do {
      _ = try await session.data(for: request)
      return false
    } catch let error as URLError {
      return error.code == .notConnectedToInternet
    } catch {
      return false
    }
  }
}
