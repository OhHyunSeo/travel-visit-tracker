const { CodeGenerator, withMainApplication } = require('expo/config-plugins');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const name = 'TripPaintingOfflineMapsPackage.kt';

module.exports = function withAndroidOfflineMaps(config) {
  return withMainApplication(config, async (config) => {
    const main = config.modResults;
    const appPackage = main.contents.match(/^package ([\w.]+)$/m)?.[1];
    if (!main.path.endsWith('.kt') || !appPackage) {
      throw new Error('Trip Painting offline maps require a Kotlin MainApplication');
    }
    const registration = CodeGenerator.mergeContents({
      tag: 'trip-painting-offline-maps-package',
      src: main.contents,
      newSrc: '          add(TripPaintingOfflineMapsPackage())',
      anchor: /^\s*\/\/ add\(MyReactNativePackage\(\)\)\s*$/,
      offset: 1,
      comment: '//',
    }).contents;
    main.contents = CodeGenerator.mergeContents({
      tag: 'trip-painting-offline-maps-startup',
      src: registration,
      newSrc: '    TripPaintingOfflineMapsPackage.configure(this)',
      anchor: /^\s*loadReactNative\(this\)\s*$/,
      offset: 0,
      comment: '//',
    }).contents;
    const source = await readFile(require.resolve(`./android/${name}`), 'utf8');
    await writeFile(
      path.join(path.dirname(main.path), name),
      source.replace('__APP_PACKAGE__', appPackage),
    );
    return config;
  });
};
