import Foundation

@main
enum MapHTTPResponseProbe {
  private struct Input: Decodable {
    let maximumBodyBytes: Int
    let chunks: [Data]
  }

  private struct Output: Encodable {
    let readLimits: [Int]
    let terminalReadLimit: Int
    let rejectedAt: String?
    let statusCode: Int?
    let url: String?
    let headers: [String: String]?
    let body: Data?
  }

  static func main() throws {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let cases = try JSONDecoder().decode([Input].self, from: input)
    let url = URL(string: "https://fixture.invalid/map")!
    let results = cases.map { evaluate($0, at: url) }
    FileHandle.standardOutput.write(try JSONEncoder().encode(results))
  }

  private static func evaluate(_ input: Input, at url: URL) -> Output {
    var parser = TripPaintingMapHTTPResponse(maximumBodyBytes: input.maximumBodyBytes)
    var readLimits = [parser.nextReadLimit]
    for chunk in input.chunks {
      do {
        try parser.append(chunk)
        readLimits.append(parser.nextReadLimit)
      } catch {
        return Output(readLimits: readLimits, terminalReadLimit: parser.nextReadLimit,
                      rejectedAt: "append", statusCode: nil, url: nil, headers: nil, body: nil)
      }
    }
    do {
      let (response, body) = try parser.finish(at: url)
      var headers = [String: String]()
      for (key, value) in response.allHeaderFields {
        guard let name = key as? String, let text = value as? String else { continue }
        headers[name.lowercased()] = text
      }
      return Output(readLimits: readLimits, terminalReadLimit: parser.nextReadLimit,
                    rejectedAt: nil, statusCode: response.statusCode, url: response.url?.absoluteString,
                    headers: headers, body: body)
    } catch {
      return Output(readLimits: readLimits, terminalReadLimit: parser.nextReadLimit,
                    rejectedAt: "finish", statusCode: nil, url: nil, headers: nil, body: nil)
    }
  }
}
