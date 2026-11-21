internal import EXConstants
internal import ExpoAsset
internal import ExpoModulesCore
internal import ExpoSQLite

@objc(ExpoModulesProvider)
final class QAExpoModulesProvider: ModulesProvider {
  override func getModuleClasses() -> [ExpoModuleTupleType] {
    [
      (module: AssetModule.self, name: nil),
      (module: ConstantsModule.self, name: nil),
      (module: SQLiteModule.self, name: nil),
    ]
  }
}
