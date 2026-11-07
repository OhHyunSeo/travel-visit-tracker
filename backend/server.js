const { readConfig } = require('./src/config');
const { createBackend } = require('./src/app');

async function startServer() {
  const config = readConfig();
  const backend = await createBackend(config);
  const server = backend.app.listen(config.port, config.host, () => {
    console.log(
      `Travel Visit Tracker Backend listening on ${config.host}:${server.address().port}`,
    );
  });
  server.on('error', async (error) => {
    console.error('Failed to start server:', error.message);
    await backend.close();
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      server.close(async () => {
        await backend.close();
        process.exitCode = 0;
      });
    });
  return { server, ...backend };
}
if (require.main === module)
  startServer().catch((error) => {
    console.error('Failed to start server:', error.message);
    process.exitCode = 1;
  });
module.exports = { startServer };
