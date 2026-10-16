import { createApp } from './app.js';
import { config } from './config.js';
import { getDb } from './db.js';

getDb(); // run migrations before accepting traffic

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Entryout API listening on http://localhost:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
