import CryptoKit
import Foundation

// A validated description of one operation. Creating it does not arm the transport.
struct TripPaintingMapRequestScope: Equatable {
  enum ResourceKind: String {
    case vectorTile, rasterTile, glyph, sprite
  }

  private struct Limits: Decodable, Equatable {
    let maxTileAttempts: Int
    let maxBodyBytes: Int
    let maxConcurrentRequests: Int
  }

  private struct Range: Decodable, Equatable {
    let source: String
    let zoom: Int
    let minX: Int
    let maxX: Int
    let minY: Int
    let maxY: Int
    let count: Int
  }

  private struct Plan: Decodable, Equatable {
    struct Revision: Decodable, Equatable {
      let styleSha256: String
      let tileVersion: String
    }
    let schemaVersion: Int
    let provider: String
    let style: String
    let policyRevision: String
    let boundaryPackId: String
    let boundaryPackVersion: String
    let regionId: String
    let bounds: [Double]
    let minZoom: Int
    let maxZoom: Int
    let revision: Revision
    let tileRanges: [Range]
    let estimatedTileCount: Int
  }

  private struct Resources: Decodable, Equatable {
    let vector: String
    let raster: String
    let glyphs: String
    let fontStacks: [String]
    let sprite: String
  }

  private struct VectorCoverage: Decodable {
    let bounds: [Double]
    let minzoom: Int
    let maxzoom: Int
    let attribution: String
  }

  private struct Payload: Decodable, Equatable {
    let schemaVersion: Int
    let origin: String
    let operationId: String
    let localStyleSha256: String
    let tileJsonSha256: String
    let plan: Plan
    let resources: Resources
    let limits: Limits
  }

  private struct PackMetadata: Decodable {
    let kind: String
    let schemaVersion: Int
    let operationId: String
    let plan: String
    let tileJsonSha256: String
    let localStyleSha256: String
  }

  private static let providerOrigin = "https://tiles.openfreemap.org"
  private static let coordinateTemplate = "{z}/{x}/{y}"
  private static let fontStacks = ["Noto Sans Regular", "Noto Sans Italic", "Noto Sans Bold"]
  private static let mercatorLimit = atan(sinh(Double.pi)) * 180 / Double.pi

  private let payload: Payload
  private var plan: Plan { payload.plan }
  private var resources: Resources { payload.resources }
  var operationId: String { payload.operationId }
  var localStyleSha256: String { payload.localStyleSha256 }

  static func validate(_ json: String, styleJSON: String) -> Self? {
    guard json.utf8.count <= 16 * 1024, styleJSON.utf8.count <= 96 * 1024,
          let payload = try? JSONDecoder().decode(Payload.self, from: Data(json.utf8))
    else { return nil }
    let scope = Self(payload: payload)
    return scope.hasValidPolicy() && scope.hasValidPlan() && scope.matchesStyle(Data(styleJSON.utf8)) ? scope : nil
  }

  static func validatePrepared(_ json: String, styleJSON: String, metadataJSON: String) -> Self? {
    guard metadataJSON.utf8.count <= 20_000,
          let scope = validate(json, styleJSON: styleJSON),
          let metadata = try? JSONDecoder().decode(PackMetadata.self, from: Data(metadataJSON.utf8)),
          metadata.kind == "trip-painting-background-map", metadata.schemaVersion == 1,
          metadata.operationId == scope.operationId, metadata.localStyleSha256 == scope.localStyleSha256,
          metadata.tileJsonSha256 == scope.payload.tileJsonSha256,
          let plan = try? JSONDecoder().decode(Plan.self, from: Data(metadata.plan.utf8)),
          plan == scope.plan
    else { return nil }
    return scope
  }

  private static func matches(_ value: String, _ pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) == value.startIndex..<value.endIndex
  }

  private func hasValidPolicy() -> Bool {
    let digest = "[a-f0-9]{64}"
    let origin = payload.origin
    let limits = payload.limits
    guard payload.schemaVersion == 1, origin == Self.providerOrigin,
          limits.maxTileAttempts == 2_500, limits.maxBodyBytes == 50_000_000,
          limits.maxConcurrentRequests == 4,
          Self.matches(operationId, "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"),
          Self.matches(localStyleSha256, digest), Self.matches(payload.tileJsonSha256, digest),
          Self.matches(plan.revision.styleSha256, digest),
          Self.matches(plan.revision.tileVersion, "[0-9]{8}_[0-9]{6}_pt")
    else { return false }
    let coordinates = Self.coordinateTemplate
    return resources.vector == "\(origin)/planet/\(plan.revision.tileVersion)/\(coordinates).pbf"
      && resources.raster == "\(origin)/natural_earth/ne2sr/\(coordinates).png"
      && resources.glyphs == "\(origin)/fonts/{fontstack}/{range}.pbf"
      && resources.sprite.hasPrefix("\(origin)/sprites/")
      && Self.matches(String(resources.sprite.dropFirst("\(origin)/sprites/".count)), "[A-Za-z0-9_-]{1,64}/ofm")
  }

  private func hasValidPlan() -> Bool {
    let bounds = plan.bounds
    guard plan.schemaVersion == 1, plan.provider == "openfreemap", plan.style == "liberty",
          plan.policyRevision == "ofm-liberty-2026-10-28",
          Self.matches(plan.boundaryPackId, "KOR-ADM2-[0-9]{1,20}"),
          Self.matches(plan.boundaryPackVersion, "20[0-9]{2}-[0-9a-f]{12}"),
          Self.matches(plan.regionId, "gb:[A-Z0-9]{1,64}"),
          (8...12).contains(plan.minZoom), (plan.minZoom...12).contains(plan.maxZoom),
          bounds.count == 4, bounds.allSatisfy(\.isFinite),
          bounds[0] >= -180, bounds[2] <= 180, bounds[0] < bounds[2],
          bounds[1] >= -Self.mercatorLimit, bounds[3] <= Self.mercatorLimit, bounds[1] < bounds[3]
    else { return false }

    var ranges = (plan.minZoom...plan.maxZoom).map { tileRange(zoom: $0, source: "vector") }
    ranges.append(tileRange(zoom: 6, source: "raster"))
    let count = ranges.reduce(0) { $0 + $1.count }
    return ranges == plan.tileRanges && count == plan.estimatedTileCount && count <= payload.limits.maxTileAttempts
  }

  private func tileRange(zoom: Int, source: String) -> Range {
    let scale = 1 << zoom
    func x(_ longitude: Double) -> Int {
      Int(floor(((longitude + 180) / 360) * Double(scale)))
    }
    func y(_ latitude: Double) -> Int {
      let radians = (latitude * Double.pi) / 180
      return Int(floor(((1 - asinh(tan(radians)) / Double.pi) / 2) * Double(scale)))
    }
    func clamp(_ value: Int) -> Int { min(scale - 1, max(0, value)) }
    let minX = clamp(x(plan.bounds[0]) - 1)
    let maxX = clamp(x(plan.bounds[2]) + 1)
    let minY = clamp(y(plan.bounds[3]) - 1)
    let maxY = clamp(y(plan.bounds[1]) + 1)
    return Range(source: source, zoom: zoom, minX: minX, maxX: maxX, minY: minY, maxY: maxY,
                 count: (maxX - minX + 1) * (maxY - minY + 1))
  }

  private func matchesStyle(_ data: Data) -> Bool {
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    guard digest == localStyleSha256,
          let style = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          Set(style.keys) == ["version", "glyphs", "sprite", "sources", "layers"],
          style["version"] as? Int == 8, style["glyphs"] as? String == resources.glyphs,
          style["sprite"] as? String == resources.sprite,
          let layers = style["layers"] as? [[String: Any]], !layers.isEmpty,
          let sources = style["sources"] as? [String: [String: Any]],
          Set(sources.keys) == ["openmaptiles", "ne2_shaded"],
          let vector = sources["openmaptiles"], vector["type"] as? String == "vector",
          Set(vector.keys) == ["type", "tiles", "scheme", "bounds", "minzoom", "maxzoom", "attribution"],
          vector["scheme"] as? String == "xyz", vector["tiles"] as? [String] == [resources.vector],
          coversPlan(vector),
          let raster = sources["ne2_shaded"], raster["type"] as? String == "raster",
          Set(raster.keys) == ["type", "tiles", "maxzoom", "tileSize"],
          raster["tiles"] as? [String] == [resources.raster],
          raster["maxzoom"] as? Int == 6, raster["tileSize"] as? Int == 256
    else { return false }
    let explicitFonts = layers.compactMap { ($0["layout"] as? [String: Any])?["text-font"] as? [String] }
    return resources.fontStacks == Self.fontStacks.filter { explicitFonts.contains([$0]) }
  }

  private func coversPlan(_ vector: [String: Any]) -> Bool {
    guard let data = try? JSONSerialization.data(withJSONObject: vector),
          let coverage = try? JSONDecoder().decode(VectorCoverage.self, from: data),
          (0...8).contains(coverage.minzoom), (12...22).contains(coverage.maxzoom),
          coverage.bounds.count == 4, coverage.bounds.allSatisfy(\.isFinite),
          !coverage.attribution.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          coverage.attribution.utf16.count <= 4096
    else { return false }
    let bounds = coverage.bounds
    return bounds[0] >= -180 && bounds[0] <= plan.bounds[0]
      && bounds[1] >= -90 && bounds[1] <= plan.bounds[1]
      && bounds[2] <= 180 && bounds[2] >= plan.bounds[2]
      && bounds[3] <= 90 && bounds[3] >= plan.bounds[3]
  }

  // Compare the raw address. Reconstructing it from parsed URL components could hide escapes or queries.
  func resourceKind(for address: String, method: String) -> ResourceKind? {
    let origin = payload.origin
    guard method == "GET", address.hasPrefix(origin + "/"), address.utf8.count <= 512 else { return nil }
    if matchesTile(address, template: resources.vector, source: "vector") { return .vectorTile }
    if matchesTile(address, template: resources.raster, source: "raster") { return .rasterTile }
    if [".json", ".png", "@2x.json", "@2x.png"].contains(where: { address == resources.sprite + $0 }) {
      return .sprite
    }

    for font in resources.fontStacks {
      let prefix = "\(origin)/fonts/\(font.replacingOccurrences(of: " ", with: "%20"))/"
      guard address.hasPrefix(prefix), address.hasSuffix(".pbf") else { continue }
      let range = address.dropFirst(prefix.count).dropLast(4).split(separator: "-", omittingEmptySubsequences: false)
      if range.count == 2, let first = Int(range[0]), let last = Int(range[1]),
         (0...65_280).contains(first), first % 256 == 0, last == first + 255,
         String(first) == range[0], String(last) == range[1] { return .glyph }
    }
    return nil
  }

  private func matchesTile(_ address: String, template: String, source: String) -> Bool {
    let parts = template.components(separatedBy: Self.coordinateTemplate)
    guard parts.count == 2, address.hasPrefix(parts[0]), address.hasSuffix(parts[1]) else { return false }
    let values = address.dropFirst(parts[0].count).dropLast(parts[1].count)
      .split(separator: "/", omittingEmptySubsequences: false)
    guard values.count == 3, let zoom = Int(values[0]), let x = Int(values[1]), let y = Int(values[2]),
          String(zoom) == values[0], String(x) == values[1], String(y) == values[2],
          let range = plan.tileRanges.first(where: { $0.source == source && $0.zoom == zoom })
    else { return false }
    return (range.minX...range.maxX).contains(x) && (range.minY...range.maxY).contains(y)
  }
}
