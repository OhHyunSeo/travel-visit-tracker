import Foundation

/// HTTP/1.1 framing for one connection. Publish the response only after EOF confirms the exact body length.
struct TripPaintingMapHTTPResponse {
  enum Failure: Error {
    case invalidLimit, invalidHeader, unsupportedResponse, oversizedBody, incompleteMessage, extraBodyBytes, closed
  }

  private static let maximumHeaderBytes = 8_192
  private static let headerEnd = Data([13, 10, 13, 10])
  private static let fieldNameCharacters = CharacterSet(charactersIn: "!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyz")
  private static let visibleHeaders: Set<String> = [
    "content-length", "content-type", "cache-control", "etag", "expires", "last-modified", "date",
  ]

  private struct Framing {
    let length: Int
    let headers: [String: String]
  }

  private let maximumBodyBytes: Int
  private var header = Data()
  private var body = Data()
  private var framing: Framing?
  private var closed = false

  init(maximumBodyBytes: Int) {
    self.maximumBodyBytes = maximumBodyBytes
  }

  /// A bounded header read may include some body data. After framing, read only the remaining body or one EOF probe byte.
  var nextReadLimit: Int {
    guard !closed else { return 0 }
    if let framing { return min(16_384, max(1, framing.length - body.count)) }
    return min(512, Self.maximumHeaderBytes - header.count)
  }

  mutating func append(_ bytes: Data) throws {
    guard !closed else { throw Failure.closed }
    do {
      guard (1...50_000_000).contains(maximumBodyBytes) else { throw Failure.invalidLimit }
      if let framing {
        try appendBody(bytes, length: framing.length)
        return
      }

      let prefix = bytes.prefix(Self.maximumHeaderBytes - header.count)
      header.append(prefix)
      guard let end = header.range(of: Self.headerEnd) else {
        if header.count == Self.maximumHeaderBytes { throw Failure.invalidHeader }
        return
      }
      let framing = try parseHeader(header[..<end.lowerBound])
      self.framing = framing
      let firstBodyBytes = header[end.upperBound...]
      header.removeAll(keepingCapacity: false)
      try appendBody(firstBodyBytes, length: framing.length)
      try appendBody(bytes.dropFirst(prefix.count), length: framing.length)
    } catch {
      closed = true
      throw error
    }
  }

  mutating func finish(at url: URL) throws -> (response: HTTPURLResponse, body: Data) {
    guard !closed else { throw Failure.closed }
    closed = true
    guard let framing, body.count == framing.length else { throw Failure.incompleteMessage }
    guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                         headerFields: framing.headers)
    else { throw Failure.invalidHeader }
    return (response, body)
  }

  private mutating func appendBody(_ bytes: Data, length: Int) throws {
    guard bytes.count <= length - body.count else { throw Failure.extraBodyBytes }
    body.append(bytes)
  }

  private func parseHeader(_ bytes: Data) throws -> Framing {
    guard let text = String(data: bytes, encoding: .ascii) else { throw Failure.invalidHeader }
    let lines = text.components(separatedBy: "\r\n")
    guard let status = lines.first, status.hasPrefix("HTTP/1.1 200 "),
          status.utf8.allSatisfy({ (32...126).contains($0) })
    else { throw Failure.unsupportedResponse }

    var fields: [String: String] = [:]
    for line in lines.dropFirst() {
      guard let delimiter = line.firstIndex(of: ":") else { throw Failure.invalidHeader }
      let name = line[..<delimiter].lowercased()
      let value = line[line.index(after: delimiter)...].trimmingCharacters(in: CharacterSet(charactersIn: " \t"))
      guard !name.isEmpty, name.rangeOfCharacter(from: Self.fieldNameCharacters.inverted) == nil,
            fields[name] == nil, value.utf8.allSatisfy({ $0 == 9 || (32...126).contains($0) })
      else { throw Failure.invalidHeader }
      fields[name] = value
    }

    guard fields["transfer-encoding"] == nil,
          fields["content-encoding"].map({ $0.lowercased() == "identity" }) ?? true
    else { throw Failure.unsupportedResponse }
    guard let rawLength = fields["content-length"], rawLength.utf8.count <= 8,
          let length = Int(rawLength), length >= 0, String(length) == rawLength
    else { throw Failure.invalidHeader }
    guard length <= maximumBodyBytes else { throw Failure.oversizedBody }
    return Framing(length: length, headers: fields.filter { Self.visibleHeaders.contains($0.key) })
  }
}
