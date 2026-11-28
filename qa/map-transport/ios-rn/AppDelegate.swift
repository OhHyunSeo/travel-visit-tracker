internal import Expo
import React
import ReactAppDependencyProvider
import UIKit

@main
final class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  private var reactDelegate: TrialReactDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  var window: UIWindow?
  let reactNativeFactoryModuleName = "TPRNMapQA"

  override func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    if TPRNBootstrap.prepare() {
      let delegate = TrialReactDelegate()
      delegate.dependencyProvider = RCTAppDependencyProvider()
      reactDelegate = delegate
      reactNativeFactory = ExpoReactNativeFactory(delegate: delegate)
    }
    return super.application(application, didFinishLaunchingWithOptions: options)
  }
}

@objc(TPRNQAScene)
final class TrialScene: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
             options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene, window == nil else { return }
    let window = UIWindow(windowScene: scene)
    self.window = window
    guard let delegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = delegate.reactNativeFactory else {
      let controller = UIViewController()
      let label = UILabel()
      label.text = "시험 서버 설정을 확인해 주세요."
      label.textAlignment = .center
      controller.view = label
      window.rootViewController = controller
      window.makeKeyAndVisible()
      return
    }
    delegate.window = window
    factory.startReactNative(withModuleName: delegate.reactNativeFactoryModuleName, in: window,
                            initialProperties: TPRNBootstrap.initialProperties(), launchOptions: nil)
    TPRNBootstrap.observe()
  }
}

private final class TrialReactDelegate: ExpoReactNativeFactoryDelegate {
  override func bundleURL() -> URL? { Bundle.main.url(forResource: "main", withExtension: "jsbundle") }
  override func sourceURL(for bridge: RCTBridge) -> URL? { bundleURL() }
}
