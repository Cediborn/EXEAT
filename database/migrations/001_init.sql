-- Entryout initial schema
-- Applied by backend/db.js (tracked in schema_migrations).

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('student','housemaster','senior','gate','admin')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Which houses a staff member is responsible for (housemaster/housemistress).
CREATE TABLE IF NOT EXISTS staff_assignments (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  house   TEXT NOT NULL,
  PRIMARY KEY (user_id, house)
);

CREATE TABLE IF NOT EXISTS students (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  index_number   TEXT NOT NULL UNIQUE,
  class_year     TEXT NOT NULL,
  house          TEXT NOT NULL,
  guardian_name  TEXT,
  guardian_phone TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS exeat_requests (
  id              TEXT PRIMARY KEY,
  reference       TEXT NOT NULL UNIQUE,
  student_id      TEXT NOT NULL REFERENCES users(id),
  type            TEXT NOT NULL CHECK (type IN ('internal','external')),
  category        TEXT NOT NULL,
  reason          TEXT NOT NULL,
  destination     TEXT NOT NULL,
  guardian_name   TEXT,
  guardian_phone  TEXT,
  depart_at       TEXT NOT NULL,
  return_at       TEXT NOT NULL,
  urgent          INTEGER NOT NULL DEFAULT 0,
  requires_senior INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL CHECK (status IN ('pending','pending_senior','approved','rejected','returned','cancelled','completed')),
  idempotency_key TEXT UNIQUE,
  submitted_at    TEXT,
  decided_at      TEXT,
  cancel_reason   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_student ON exeat_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_requests_status  ON exeat_requests(status);

CREATE TABLE IF NOT EXISTS approval_records (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES exeat_requests(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  stage       TEXT NOT NULL CHECK (stage IN ('housemaster','senior')),
  decision    TEXT NOT NULL CHECK (decision IN ('approved','rejected','returned')),
  comment     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approvals_request ON approval_records(request_id);

CREATE TABLE IF NOT EXISTS passes (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL UNIQUE REFERENCES exeat_requests(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,
  issued_at   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('active','completed','revoked')),
  revoked_at  TEXT,
  revoke_reason TEXT,
  departed_at TEXT,
  returned_at TEXT
);

CREATE TABLE IF NOT EXISTS movement_events (
  id           TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES exeat_requests(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('departure','return')),
  recorded_at  TEXT NOT NULL,
  recorded_by  TEXT NOT NULL REFERENCES users(id),
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_request ON movement_events(request_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

-- Delivery attempts for out-of-band channels (email/SMS). In-app delivery is
-- the notifications row itself; this table records what happened when we tried
-- to reach a configured external provider.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('email','sms')),
  recipient       TEXT NOT NULL,
  provider        TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('sent','failed','not_configured')),
  detail          TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','policy','urgent')),
  active     INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  meta       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
