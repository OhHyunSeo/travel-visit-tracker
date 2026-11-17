const {
  CodeGenerator,
  IOSConfig,
  withAppDelegate,
  withXcodeProject,
} = require('expo/config-plugins');
const { copyFile } = require('node:fs/promises');
const path = require('node:path');

const helper = 'TripPaintingMapBootstrap.swift';
const bridge = 'TripPaintingOfflineMaps.m';
const style = 'TripPaintingBootstrapStyle.json';

module.exports = function withIOSMapBootstrap(config) {
  config = withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw new Error('Trip Painting map bootstrap requires the Swift AppDelegate');
    }
    config.modResults.contents = CodeGenerator.mergeContents({
      tag: 'trip-painting-local-map-bootstrap',
      src: config.modResults.contents,
      newSrc: [
        '    TripPaintingMapBootstrap.setOfflineMapRequestsBlocked(true)',
        '    TripPaintingMapBootstrap.configure()',
      ].join('\n'),
      anchor: /^    let delegate = ReactNativeDelegate\(\)$/,
      offset: 0,
      comment: '//',
    }).contents;
    return config;
  });

  return withXcodeProject(config, async (config) => {
    const { getProjectName, addBuildSourceFileToGroup, addResourceFileToGroup } =
      IOSConfig.XcodeUtils;
    const { projectRoot, platformProjectRoot } = config.modRequest;
    const groupName = getProjectName(projectRoot);
    const directory = path.join(platformProjectRoot, groupName);
    await Promise.all(
      [helper, bridge, style].map((file) =>
        copyFile(require.resolve(`./ios/${file}`), path.join(directory, file)),
      ),
    );

    const project = config.modResults;
    addBuildSourceFileToGroup({ project, groupName, filepath: path.posix.join(groupName, helper) });
    addBuildSourceFileToGroup({ project, groupName, filepath: path.posix.join(groupName, bridge) });
    addResourceFileToGroup({
      project,
      groupName,
      filepath: path.posix.join(groupName, style),
      isBuildFile: true,
    });
    return config;
  });
};
