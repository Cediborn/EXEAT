/**
 * Development seed data. All names, index numbers and phone numbers below are
 * FICTIONAL and must never be replaced with real student records.
 *
 * Run: npm run seed
 */
import { getDb, newId, nowIso, closeDb } from '../db.js';
import { hashPassword } from '../services/auth.js';
import { createRequest, decide } from '../services/workflow.js';

const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'Entryout!2026';

async function upsertUser(db, { username, fullName, role, email = null, houses = [], profile = null }) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return existing.id;
  const id = newId();
  const now = nowIso();
  const hash = await hashPassword(DEMO_PASSWORD);
  db.prepare(`INSERT INTO users (id, username, email, password_hash, full_name, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(id, username, email, hash, fullName, role, now, now);
  for (const house of houses) {
    db.prepare('INSERT OR IGNORE INTO staff_assignments (user_id, house) VALUES (?, ?)').run(id, house);
  }
  if (profile) {
    db.prepare('INSERT INTO students (user_id, index_number, class_year, house, guardian_name, guardian_phone) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, profile.indexNumber, profile.classYear, profile.house, profile.guardianName, profile.guardianPhone);
  }
  return id;
}

async function seed() {
  const db = getDb();

  const adminId = await upsertUser(db, { username: 'ADMIN01', fullName: 'Portal Administrator', role: 'admin', email: 'admin@example.test' });
  const hmBalmer = await upsertUser(db, {
    username: 'HM-BALMER', fullName: 'Example Housemaster (Balmer-Acquaah)', role: 'housemaster',
    email: 'housemaster.balmer@example.test', houses: ['Balmer-Acquaah'],
  });
  await upsertUser(db, {
    username: 'HM-PICKARD', fullName: 'Example Housemaster (Pickard-Parker)', role: 'housemaster',
    houses: ['Pickard-Parker'],
  });
  const seniorId = await upsertUser(db, {
    username: 'SNR-HOUSE', fullName: 'Example Senior Housemaster', role: 'senior', email: 'senior@example.test',
  });
  const gateId = await upsertUser(db, { username: 'GATE01', fullName: 'Example Gate Officer', role: 'gate' });

  const studentA = await upsertUser(db, {
    username: 'MFS/26/0001', fullName: 'Kwabena Mensah (demo)', role: 'student', email: 'student.a@example.test',
    profile: {
      indexNumber: 'MFS/26/0001', classYear: 'SHS 2', house: 'Balmer-Acquaah',
      guardianName: 'Adjoa Mensah', guardianPhone: '0241110001',
    },
  });
  await upsertUser(db, {
    username: 'MFS/26/0002', fullName: 'Ama Owusu (demo)', role: 'student',
    profile: {
      indexNumber: 'MFS/26/0002', classYear: 'SHS 1', house: 'Pickard-Parker',
      guardianName: 'Kofi Owusu', guardianPhone: '0241110002',
    },
  });

  if (db.prepare('SELECT COUNT(*) AS n FROM announcements').get().n === 0) {
    const insert = db.prepare('INSERT INTO announcements (id, title, body, level, active, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)');
    const now = nowIso();
    insert.run(newId(), 'No exeats during midterm exams',
      'All exeat requests will be rejected during midterm examinations. Students are expected to remain on campus for study. Only medical emergencies will be considered.', 'urgent', adminId, now);
    insert.run(newId(), '24-hour notice required for external exeats',
      'All external exeat applications must be submitted at least 24 hours before your departure date. This allows proper review by the Housemaster/Housemistress and Senior Housemaster/Senior Housemistress.', 'policy', adminId, now);
  }

  // One demo request in each interesting state, for reviewing the UI end to end.
  if (db.prepare('SELECT COUNT(*) AS n FROM exeat_requests').get().n === 0) {
    const student = { id: studentA, role: 'student' };
    const reviewer = { id: hmBalmer, role: 'housemaster', houses: ['Balmer-Acquaah'] };
    const senior = { id: seniorId, role: 'senior', houses: [] };

    const hours = (n) => new Date(Date.now() + n * 3600 * 1000).toISOString();

    const approved = createRequest(student, {
      type: 'internal', category: 'family', reason: 'Visiting my aunt in Cape Coast for the weekend',
      destination: 'Cape Coast — Ridge home', departDate: isoDate(hours(30)), departTime: '08:00',
      returnDate: isoDate(hours(46)), returnTime: '17:00',
    }, `seed-approved-${Date.now()}`);
    decide(reviewer, approved.id, 'approved', 'Approved. Travel safely.');

    const pending = createRequest(student, {
      type: 'external', category: 'medical_appointment', reason: 'Dental appointment at the district clinic',
      destination: 'Cape Coast Municipal Hospital', departDate: isoDate(hours(70)), departTime: '09:00',
      returnDate: isoDate(hours(78)), returnTime: '15:00', guardianName: 'Adjoa Mensah', guardianPhone: '0241110001',
    }, `seed-pending-${Date.now()}`);

    const returned = createRequest(student, {
      type: 'internal', category: 'personal', reason: 'Going to town to buy school supplies for the term',
      destination: 'Cape Coast central market', departDate: isoDate(hours(100)), departTime: '14:00',
      returnDate: isoDate(hours(106)), returnTime: '18:00',
    }, `seed-returned-${Date.now()}`);
    decide(reviewer, returned.id, 'returned', 'State the exact shop area and who is accompanying you.');

    const seniorPending = createRequest(student, {
      type: 'external', category: 'family', reason: 'Family funeral ceremony at Effutu',
      destination: 'Effutu', departDate: isoDate(hours(120)), departTime: '06:00',
      returnDate: isoDate(hours(140)), returnTime: '20:00', guardianName: 'Adjoa Mensah', guardianPhone: '0241110001',
    }, `seed-senior-${Date.now()}`);
    decide(reviewer, seniorPending.id, 'approved', 'Housemaster approved; please confirm with senior housemaster.');

    console.log('Seeded demo requests:', { approved: approved.reference, pending: pending.reference, returned: returned.reference, seniorPending: seniorPending.reference });
  }

  console.log('\nSeed complete. DEMO ACCOUNTS (password below is for local development only):');
  console.log(`  Password for all demo accounts: ${DEMO_PASSWORD}`);
  console.log('  admin          ADMIN01');
  console.log('  housemaster    HM-BALMER   (Balmer-Acquaah)');
  console.log('  housemaster    HM-PICKARD  (Pickard-Parker)');
  console.log('  senior         SNR-HOUSE');
  console.log('  gate           GATE01');
  console.log('  student        MFS/26/0001');
  console.log('  student        MFS/26/0002');
  closeDb();
}

function isoDate(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
