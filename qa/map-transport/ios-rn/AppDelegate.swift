import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  private var reactDelegate: TrialReactDelegate?
  var factory: RCTReactNativeFactory?

  func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    if TPRNBootstrap.prepare() {
      let delegate = TrialReactDelegate()
      delegate.dependencyProvider = RCTAppDependencyProvider()
      reactDelegate = delegate
      factory = RCTReactNativeFactory(delegate: delegate)
    }
    return true
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
          let factory = delegate.factory else {
      let controller = UIViewController()
      let label = UILabel()
      label.text = "시험 서버 설정을 확인해 주세요."
      label.textAlignment = .center
      controller.view = label
      window.rootViewController = controller
      window.makeKeyAndVisible()
      return
    }
    factory.startReactNative(withModuleName: "TPRNMapQA", in: window,
                            initialProperties: TPRNBootstrap.initialProperties(), launchOptions: nil)
    TPRNBootstrap.observe()
  }
}

private final class TrialReactDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func bundleURL() -> URL? { Bundle.main.url(forResource: "main", withExtension: "jsbundle") }
  override func sourceURL(for bridge: RCTBridge) -> URL? { bundleURL() }
}
