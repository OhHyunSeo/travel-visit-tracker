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
    let requests: [Request]
  }

  struct Result: Encodable {
    let accepted: Bool
    let resources: [String?]
  }

  static func main() throws {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    let cases = try JSONDecoder().decode([Case].self, from: data)
    let results = cases.map { item in
      let scope = TripPaintingMapRequestScope.validate(item.scope, styleJSON: item.style)
      return Result(accepted: scope != nil, resources: item.requests.map {
        scope?.resourceKind(for: $0.address, method: $0.method)?.rawValue
      })
    }
    FileHandle.standardOutput.write(try JSONEncoder().encode(results))
  }
}
