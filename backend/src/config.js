const path = require('node:path');

function validateSecret(secret) {
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret, 'utf8') < 32 ||
    !secret.trim() ||
    secret === 'your-secret-key-change-in-production'
  ) {
    throw new Error('JWT_SECRET must be explicitly set to a random secret of at least 32 bytes.');
  }
  return secret;
}
function readConfig(env = process.env) {
  const root = path.resolve(__dirname, '..');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('PORT must be a valid port.');
  return {
    jwtSecret: validateSecret(env.JWT_SECRET),
    port,
    host: env.HOST || '127.0.0.1',
    dbPath: path.resolve(env.DB_PATH || path.join(root, 'data/database.sqlite')),
    uploadsDir: path.resolve(env.UPLOADS_DIR || path.join(root, 'uploads')),
    dataDir: path.join(root, 'data'),
    corsOrigins: (env.CORS_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    logging: true,
  };
}
module.exports = { readConfig, validateSecret };
