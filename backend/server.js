import { createApp } from './app.js';
import { config } from './config.js';
import { getDb, newId, nowIso } from './db.js';
import { hashPassword } from './services/auth.js';
import { audit } from './middleware/auth.js';

try {
  getDb(); // run migrations before accepting traffic
} catch (err) {
  console.error(`FATAL: database initialisation failed: ${err.message}`);
  console.error(`Database path: ${config.databasePath}`);
  console.error('Check that the directory exists and is writable, then restart.');
  process.exit(1);
}

// One-time first-boot provisioning: creates the initial admin account when
// BOOTSTRAP_ADMIN_USERNAME/PASSWORD are set and no admin exists yet.
// Never logs the password. No-op in development and once any admin exists.
await bootstrapAdmin();

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Entryout API listening on port ${config.port} (${config.nodeEnv})`);
  console.log(`Database: ${config.databasePath}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`FATAL: port ${config.port} is already in use. Set PORT to a free port.`);
  } else {
    console.error(`FATAL: server failed to start: ${err.message}`);
  }
  process.exit(1);
});

async function bootstrapAdmin() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password) return;

  const db = getDb();
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get()) return;

  const user = username.toUpperCase();
  if (!/^[A-Z0-9._-]{3,40}$/.test(user)) {
    console.error('FATAL: BOOTSTRAP_ADMIN_USERNAME must be 3-40 letters, digits, dots or dashes.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('FATAL: BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(user)) {
    console.error(`Bootstrap admin not created: username ${user} already exists.`);
    return;
  }

  const id = newId();
  const now = nowIso();
  const fullName = (process.env.BOOTSTRAP_ADMIN_FULLNAME || 'School Administrator').slice(0, 80);
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase() || null;
  const hash = await hashPassword(password);
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO users (id, username, email, password_hash, full_name, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'admin', 1, ?, ?)`).run(id, user, email || null, hash, fullName, now, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  audit(id, 'admin_bootstrapped', 'users', id, { username: user });
  console.log(`Bootstrap admin created: ${user}. Remove BOOTSTRAP_ADMIN_* variables after the first sign-in.`);
}

function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
