require 'xcodeproj'

ios = File.realpath(ARGV.fetch(0))
unless ios.match?(%r{/qa/map-transport/ios-rn/\.build/[a-zA-Z0-9-]+/ios\z})
  abort 'Expected a staged QA project'
end
project = Xcodeproj::Project.open(File.join(ios, 'TripPainting.xcodeproj'))
app = project.targets.find { |target| target.name == 'TripPainting' } || abort('Missing staged app')
keep = ['[CP] Check Pods Manifest.lock', '[CP] Copy Pods Resources',
        '[CP] Embed Pods Frameworks', '[MapLibre React Native] Remove MapLibre.xcframework-ios.signature']
app.shell_script_build_phases.each { |phase| phase.remove_from_project unless keep.include?(phase.name) }
app.source_build_phase.files.to_a.each do |file|
  file.remove_from_project if file.file_ref&.display_name == 'ExpoModulesProvider.swift'
end
group = project.main_group.find_subpath('TripPainting', false) || abort('Missing staged app group')
%w[TPRNBootstrap.m TPTransport.m TPHTTPExchange.m main.jsbundle].each do |file|
  phase = file.end_with?('.m') ? app.source_build_phase : app.resources_build_phase
  reference = group.files.find { |item| item.display_name == file }
  reference ||= group.new_file("TripPainting/#{file}")
  reference.path = "TripPainting/#{file}"
  phase.add_file_reference(reference, true)
end
app.build_configurations.each do |configuration|
  settings = configuration.build_settings
  settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'app.trippainting.rnmapqa'
  settings['ENABLE_DEBUG_DYLIB'] = 'NO'
  settings.delete('CODE_SIGN_ENTITLEMENTS')
  settings['HEADER_SEARCH_PATHS'] = ['$(inherited)',
    '$(SRCROOT)/../node_modules/@maplibre/maplibre-react-native/ios/modules/transform-request']
end
project.save
