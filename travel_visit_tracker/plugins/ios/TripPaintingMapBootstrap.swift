import Foundation
import MapLibre

@objc(TripPaintingMapBootstrap)
final class TripPaintingMapBootstrap: NSObject {
  @discardableResult
  @objc(configureInDirectory:)
  static func configure(in directory: URL = Bundle.main.bundleURL) -> Bool {
    guard directory.isFileURL, let options = MLNSettings.tileServerOptions else { return false }

    // Keep a local URL even when the file is missing, so the SDK never selects its remote default.
    let url = directory.appendingPathComponent("TripPaintingBootstrapStyle.json")
    let style = MLNDefaultStyle()
    style.url = url
    style.name = "Trip Painting local bootstrap"
    style.version = 1
    options.defaultStyles = options.defaultStyles.filter { $0.name != style.name } + [style]
    options.defaultStyle = style
    MLNSettings.tileServerOptions = options
    return MLNStyle.defaultStyleURL() == url
  }
}
