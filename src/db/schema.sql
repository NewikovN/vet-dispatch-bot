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
  address            TEXT NOT NULL DEFAULT '',
  animal             TEXT NOT NULL,
  problem            TEXT NOT NULL,
  price_note         TEXT NOT NULL DEFAULT '',
  client_contacts    TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'taken', 'approved', 'closed', 'cancelled')),
  assigned_doctor_id TEXT REFERENCES users(user_id),
  check_amount       INTEGER,
  group_message_id   TEXT,
  manage_message_id  TEXT,
  created_at         TEXT NOT NULL,
  taken_at           TEXT,
  approved_at        TEXT,
  closed_at          TEXT,
  cancelled_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);

-- Город может быть настроен наполовину (сначала привязали один чат, потом второй) —
-- поэтому оба поля nullable, а не NOT NULL.
CREATE TABLE IF NOT EXISTS city_chats (
  city            TEXT PRIMARY KEY,
  work_chat_id    TEXT,
  manage_chat_id  TEXT
);

-- Учёт вакцинаций — отдельная сущность, НЕ связана с requests. Добавляют директор/управляющий
-- вручную в личке; запись только сохраняется в БД, никуда не постится в чаты (в отличие от
-- заявок). IF NOT EXISTS — на боевой базе таблица появится при следующем запуске без сноса
-- существующих данных (db/index.ts применяет весь schema.sql при каждом старте).
CREATE TABLE IF NOT EXISTS vaccinations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  city              TEXT NOT NULL,
  vaccination_date  TEXT NOT NULL,
  vaccine_type      TEXT NOT NULL,
  animal            TEXT NOT NULL,
  next_date         TEXT,
  client_contacts   TEXT NOT NULL,
  created_by        TEXT NOT NULL REFERENCES users(user_id),
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vaccinations_city_date ON vaccinations(city, vaccination_date);