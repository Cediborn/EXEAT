import './setup-env.js';

const PASSWORD = 'Testing!123';

/**
 * Insert deterministic dummy accounts used by the workflow and security tests.
 * All data is fictional. Backend modules are imported dynamically so that
 * setup-env.js has already configured the isolated test database.
 */
export async function createFixtures() {
  const { getDb, newId, nowIso } = await import('../backend/db.js');
  const { hashPassword } = await import('../backend/services/auth.js');
  const db = getDb();
  const hash = await hashPassword(PASSWORD);
  const now = nowIso();

  const makeUser = ({ username, fullName, role, email = null }) => {
    const id = newId();
    db.prepare(`INSERT INTO users (id, username, email, password_hash, full_name, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(id, username, email, hash, fullName, role, now, now);
    return id;
  };

  const users = {
    admin: makeUser({ username: 'TEST-ADMIN', fullName: 'Test Admin', role: 'admin' }),
    housemaster: makeUser({ username: 'TEST-HM1', fullName: 'Test Housemaster One', role: 'housemaster', email: 'hm1@example.test' }),
    otherHousemaster: makeUser({ username: 'TEST-HM2', fullName: 'Test Housemaster Two', role: 'housemaster' }),
    senior: makeUser({ username: 'TEST-SENIOR', fullName: 'Test Senior Housemaster', role: 'senior' }),
    gate: makeUser({ username: 'TEST-GATE', fullName: 'Test Gate Officer', role: 'gate' }),
    student: makeUser({ username: 'TEST/26/0001', fullName: 'Test Student One', role: 'student', email: 's1@example.test' }),
    otherStudent: makeUser({ username: 'TEST/26/0002', fullName: 'Test Student Two', role: 'student' }),
  };

  const assign = (userId, house) => db.prepare('INSERT INTO staff_assignments (user_id, house) VALUES (?, ?)').run(userId, house);
  assign(users.housemaster, 'Balmer-Acquaah');
  assign(users.otherHousemaster, 'Pickard-Parker');

  const studentProfile = (userId, indexNumber, house) => db.prepare(`INSERT INTO students
    (user_id, index_number, class_year, house, guardian_name, guardian_phone)
    VALUES (?, ?, ?, ?, ?, ?)`).run(userId, indexNumber, 'SHS 2', house, 'Guardian Person', '0240000000');
  studentProfile(users.student, 'MFS/26/0001', 'Balmer-Acquaah');
  studentProfile(users.otherStudent, 'MFS/26/0002', 'Pickard-Parker');

  return { users, password: PASSWORD };
}
