const path = require('node:path');
const { createRequire } = require('node:module');

const [, , projectRoot, pluginPath] = process.argv;
const requireFromProject = createRequire(path.join(projectRoot, 'package.json'));
const { compileModsAsync } = requireFromProject('expo/config-plugins');
const bootstrap = require(pluginPath);

compileModsAsync(bootstrap({ name: 'Trip Painting', slug: 'trip-painting' }), {
  projectRoot,
  platforms: ['ios'],
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
