import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Imported FIRST by every test file. Must run before any backend module is
 * loaded, because backend/config.js reads process.env at import time.
 */
process.env.NODE_ENV = 'test';
process.env.STUDENT_ENROLLMENT_CODE = 'TEST-CODE-123';
process.env.COOKIE_SECURE = 'false';
process.env.ALLOWED_ORIGINS = 'http://frontend.test';
process.env.NOTIFY_WEBHOOK_URL = '';
// Rate limits are exercised in their own dedicated test; keep them out of the
// way for the rest of the suite.
process.env.LOGIN_RATE_LIMIT_MAX = '1000';
process.env.LOGIN_RATE_LIMIT_IP_MAX = '5000';
process.env.RATE_LIMIT_API_MAX = '1000000';

export const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'entryout-test-'));
process.env.DATABASE_PATH = path.join(TEST_DB_DIR, 'test.sqlite');

export async function cleanupTestDir() {
  try {
    const { closeDb } = await import('../backend/db.js');
    closeDb();
  } catch {
    /* db module may not have been loaded */
  }
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
