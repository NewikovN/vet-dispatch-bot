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

-- Вакцинация — отдельная от requests ТАБЛИЦА (жёсткое требование заказчика — не сливать), но с
-- тем же жизненным циклом и служебными полями, что и заявка (статус, кто принял, суммa чека, id
-- карточек в чатах, таймстампы) + два собственных: vaccine_type, next_date. Общая только МЕХАНИКА
-- атомарных переходов статуса (db/workflowRepo.ts), не хранение. IF NOT EXISTS — на боевой базе
-- таблица появится/обновится при следующем запуске без сноса существующих данных (db/index.ts
-- применяет весь schema.sql при каждом старте) — ЗА ИСКЛЮЧЕНИЕМ переноса уже существующей старой
-- таблицы (city/vaccination_date/vaccine_type/animal/next_date/client_contacts/created_by/
-- created_at, без жизненного цикла) на эту структуру: такой перенос из-за переименования колонки
-- и нового CHECK-constraint требует пересборки таблицы — см. scripts/migrate-vaccinations-workflow.ts.
CREATE TABLE IF NOT EXISTS vaccinations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by         TEXT NOT NULL REFERENCES users(user_id),
  date               TEXT NOT NULL,
  city               TEXT NOT NULL,
  address            TEXT NOT NULL DEFAULT '',
  animal             TEXT NOT NULL,
  problem            TEXT NOT NULL,
  price_note         TEXT NOT NULL DEFAULT '',
  client_contacts    TEXT NOT NULL,
  vaccine_type       TEXT NOT NULL,
  next_date          TEXT,
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

CREATE INDEX IF NOT EXISTS idx_vaccinations_status ON vaccinations(status);
CREATE INDEX IF NOT EXISTS idx_vaccinations_city_date ON vaccinations(city, date);