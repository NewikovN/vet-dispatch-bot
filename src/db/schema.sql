PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id      TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  role         TEXT CHECK (role IN ('dispatcher', 'doctor', 'manager', 'director')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  dm_chat_id   TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by         TEXT NOT NULL REFERENCES users(user_id),
  date               TEXT NOT NULL,
  city               TEXT NOT NULL,
  animal             TEXT NOT NULL,
  problem            TEXT NOT NULL,
  price_note         TEXT NOT NULL DEFAULT '',
  client_contacts    TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'taken', 'approved', 'closed')),
  assigned_doctor_id TEXT REFERENCES users(user_id),
  check_amount       INTEGER,
  group_message_id   TEXT,
  manage_message_id  TEXT,
  created_at         TEXT NOT NULL,
  taken_at           TEXT,
  approved_at        TEXT,
  closed_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);

CREATE TABLE IF NOT EXISTS city_chats (
  city            TEXT PRIMARY KEY,
  work_chat_id    TEXT NOT NULL,
  manage_chat_id  TEXT NOT NULL
);