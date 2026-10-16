import fs from 'node:fs';
import { config } from '../config.js';
import { closeDb } from '../db.js';

if (!config.isTest && process.env.CONFIRM !== 'yes') {
  console.error('This deletes the local database. Re-run with CONFIRM=yes (or CONFIRM=yes npm run reset-db).');
  process.exit(1);
}
closeDb();
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${config.databasePath}${suffix}`;
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    console.log('Removed', file);
  }
}
console.log('Database reset. Run npm run migrate && npm run seed to recreate it.');
