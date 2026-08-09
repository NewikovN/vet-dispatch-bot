/**
 * scripts/seed.ts — DEV-ТОЛЬКО, в прод не идёт.
 *
 * Наполняет ТЕСТОВУЮ базу реалистичными данными (направления, пользователи, заявки на все
 * статусы, раскиданные по месяцам даты), чтобы проверять /отчет и его фильтры без ручного
 * создания заявок через бота одну за другой.
 *
 * ИЗОЛЯЦИЯ ОТ РАБОЧЕЙ БАЗЫ (важно):
 * - Скрипт открывает СВОЙ файл БД по пути из SEED_DB_PATH (по умолчанию "data-seed.db" в
 *   корне проекта). Путь к рабочей data.db в этом файле нигде не фигурирует.
 * - Явная защита ниже: если SEED_DB_PATH указывает на файл с именем "data.db" — скрипт
 *   отказывается работать и завершается с ошибкой, а не тихо перезаписывает боевые данные.
 * - НЕ импортирует src/db/index.ts и репозитории (там модуль-синглтон БД) — работает с базой
 *   напрямую через собственное соединение better-sqlite3, чтобы даже ошибка в путях НЕ имела
 *   шанса задеть рабочий data.db через общий модуль.
 * - Перед наполнением стирает содержимое таблиц В ЭТОМ ФАЙЛЕ (DELETE FROM, не DROP TABLE —
 *   схема остаётся) — можно запускать многократно, результат каждый раз одинаковый (детерминированно).
 *
 * Запуск: pnpm seed
 * Как посмотреть результат в боте — см. README-подсказку в конце вывода скрипта.
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { MSK_OFFSET_HOURS } from '../src/domain/datetime.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');

const SEED_DB_PATH = resolve(projectRoot, process.env.SEED_DB_PATH ?? 'data-seed.db');

// Защита от случайного затирания рабочей базы
if (/(^|[\\/])data\.db$/.test(SEED_DB_PATH)) {
  console.error(`Отказ: SEED_DB_PATH указывает на рабочую базу (${SEED_DB_PATH}).`);
  console.error('Сид-скрипт работает только с отдельным файлом. Использование: SEED_DB_PATH=data-seed.db pnpm seed');
  process.exit(1);
}

console.log('Сид-скрипт (dev-only): наполняю', SEED_DB_PATH);

const db = new Database(SEED_DB_PATH);
db.pragma('foreign_keys = ON');
const schema = readFileSync(join(projectRoot, 'src/db/schema.sql'), 'utf8');
db.exec(schema);

// Идемпотентность: чистим содержимое, схему не трогаем
db.exec(`
  DELETE FROM requests;
  DELETE FROM users;
  DELETE FROM city_chats;
`);

// ---------- Направления ----------
const CITIES = [
  { city: 'Владимир', workChatId: '-1000000001', manageChatId: '-1000000002' },
  { city: 'Москва и область', workChatId: '-1000000003', manageChatId: '-1000000004' },
  { city: 'Нижний Новгород', workChatId: '-1000000005', manageChatId: '-1000000006' },
  { city: 'Иваново', workChatId: '-1000000007', manageChatId: '-1000000008' },
];

const insertCityChat = db.prepare(`
  INSERT INTO city_chats (city, work_chat_id, manage_chat_id) VALUES (@city, @workChatId, @manageChatId)
`);
for (const c of CITIES) insertCityChat.run(c);

// ---------- Пользователи ----------
const USERS = [
  { userId: 'seed-director-1', displayName: 'Директор Тестов', role: 'director' },
  { userId: 'seed-manager-1', displayName: 'Управляющий Иванов', role: 'manager' },
  { userId: 'seed-manager-2', displayName: 'Управляющая Петрова', role: 'manager' },
  { userId: 'seed-dispatcher-1', displayName: 'Диспетчер Сидорова', role: 'dispatcher' },
  { userId: 'seed-doctor-1', displayName: 'Врач Кузнецов', role: 'doctor' },
  { userId: 'seed-doctor-2', displayName: 'Врач Смирнова', role: 'doctor' },
  { userId: 'seed-doctor-3', displayName: 'Врач Орлов', role: 'doctor' },
  { userId: 'seed-doctor-4', displayName: 'Врач Соколова', role: 'doctor' },
];

const insertUser = db.prepare(`
  INSERT INTO users (user_id, display_name, role, status, dm_chat_id, created_at)
  VALUES (@userId, @displayName, @role, 'active', @userId, @createdAt)
`);
const nowIso = new Date().toISOString();
for (const u of USERS) insertUser.run({ ...u, createdAt: nowIso });

const doctors = USERS.filter((u) => u.role === 'doctor');
const dispatcher = USERS.find((u) => u.role === 'dispatcher')!;

// ---------- Заявки ----------
const YEAR = 2026;
const MONTHS = [4, 5, 6, 7, 8]; // апрель..август — 5 месяцев, есть на чём проверять диапазоны

const ANIMALS = ['Кот, 3 года', 'Собака, 5 лет', 'Кот, 1 год', 'Собака, 8 лет', 'Кролик, 2 года', 'Попугай, 4 года'];
const PROBLEMS = [
  'Не ест второй день',
  'Хромает на заднюю лапу',
  'Рвота, вялость',
  'Плановая вакцинация',
  'Порез на лапе, кровотечение',
  'Подозрение на отравление',
  'Затруднённое дыхание',
  'Осмотр после операции',
];
const PRICE_NOTES = ['Осмотр 1500', 'Выезд + осмотр 2000', 'Согласовано по телефону', '', 'Осмотр + анализы 3500'];
const CLIENT_NAMES = ['Тест Клиент', 'Иван Тестов', 'Мария Пробная', 'Пётр Демо', 'Анна Образцова'];

// Смесь статусов с перевесом в сторону закрытых/одобренных — чтобы было на чём проверять суммы чеков
const STATUS_CYCLE = [
  'open',
  'taken',
  'approved',
  'closed',
  'closed',
  'approved',
  'taken',
  'open',
  'closed',
  'approved',
] as const;

/** Момент времени в МСК (месяц 1-12) → ISO UTC строка, тем же способом, что и весь остальной код */
function mskDate(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(Date.UTC(year, month - 1, day, hour - MSK_OFFSET_HOURS, minute, 0, 0)).toISOString();
}

function shiftHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString();
}

/** "Дата выезда" (текстовое поле, вводится диспетчером) — на пару дней позже создания заявки */
function fakeDepartureDate(createdIso: string): string {
  const d = new Date(createdIso);
  d.setUTCDate(d.getUTCDate() + 2);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${d.getUTCFullYear()}`;
}

function fakeContacts(i: number): string {
  const name = CLIENT_NAMES[i % CLIENT_NAMES.length];
  const phone = `+7900${String(1000000 + i).slice(-7)}`;
  return `${name}, ${phone}`;
}

interface SeedRequestRow {
  createdBy: string;
  date: string;
  city: string;
  animal: string;
  problem: string;
  priceNote: string;
  clientContacts: string;
  status: string;
  assignedDoctorId: string | null;
  checkAmount: number | null;
  createdAt: string;
  takenAt: string | null;
  approvedAt: string | null;
  closedAt: string | null;
}

const rows: SeedRequestRow[] = [];
let seq = 0;

for (const month of MONTHS) {
  for (let i = 0; i < 10; i++) {
    const day = 3 + i * 2; // 3, 5, 7 ... 21 — гарантированно в пределах месяца
    const city = CITIES[seq % CITIES.length].city;
    const doctor = doctors[seq % doctors.length];
    const status = STATUS_CYCLE[seq % STATUS_CYCLE.length];
    const createdAt = mskDate(YEAR, month, day, 9 + (seq % 10), (seq * 7) % 60);

    let assignedDoctorId: string | null = null;
    let takenAt: string | null = null;
    let approvedAt: string | null = null;
    let closedAt: string | null = null;
    let checkAmount: number | null = null;

    if (status !== 'open') {
      assignedDoctorId = doctor.userId;
      takenAt = shiftHours(createdAt, 1 + (seq % 5));
    }
    if (status === 'approved' || status === 'closed') {
      approvedAt = shiftHours(takenAt!, 1 + (seq % 3));
    }
    if (status === 'closed') {
      closedAt = shiftHours(approvedAt!, 2 + (seq % 6));
      checkAmount = (1000 + (seq % 20) * 250) * 100; // копейки: 1000–5750 ₽
    }

    rows.push({
      createdBy: dispatcher.userId,
      date: fakeDepartureDate(createdAt),
      city,
      animal: ANIMALS[seq % ANIMALS.length],
      problem: PROBLEMS[seq % PROBLEMS.length],
      priceNote: PRICE_NOTES[seq % PRICE_NOTES.length],
      clientContacts: fakeContacts(seq),
      status,
      assignedDoctorId,
      checkAmount,
      createdAt,
      takenAt,
      approvedAt,
      closedAt,
    });

    seq++;
  }
}

// Граничные случаи: последние/первые часы месяца по МСК — на них проверяется корректность
// границ /отчет <ГГГГ.ММ> и /отчет <ГГГГ.ММ-ГГГГ.ММ> (см. domain/datetime.ts)
const BOUNDARY_CASES: Array<[month: number, day: number, hour: number, minute: number, note: string]> = [
  [4, 30, 23, 50, '30 апреля 23:50 МСК — должна попасть в апрель'],
  [5, 1, 0, 10, '1 мая 00:10 МСК — должна попасть в май'],
  [7, 31, 23, 55, '31 июля 23:55 МСК — должна попасть в июль'],
  [8, 1, 0, 5, '1 августа 00:05 МСК — должна попасть в август'],
];

for (const [month, day, hour, minute, note] of BOUNDARY_CASES) {
  const createdAt = mskDate(YEAR, month, day, hour, minute);
  const city = CITIES[seq % CITIES.length].city;

  rows.push({
    createdBy: dispatcher.userId,
    date: fakeDepartureDate(createdAt),
    city,
    animal: ANIMALS[seq % ANIMALS.length],
    problem: `[граница месяца] ${note}`,
    priceNote: '',
    clientContacts: fakeContacts(seq),
    status: 'open',
    assignedDoctorId: null,
    checkAmount: null,
    createdAt,
    takenAt: null,
    approvedAt: null,
    closedAt: null,
  });

  seq++;
}

const insertRequest = db.prepare(`
  INSERT INTO requests
    (created_by, date, city, animal, problem, price_note, client_contacts, status,
     assigned_doctor_id, check_amount, created_at, taken_at, approved_at, closed_at)
  VALUES
    (@createdBy, @date, @city, @animal, @problem, @priceNote, @clientContacts, @status,
     @assignedDoctorId, @checkAmount, @createdAt, @takenAt, @approvedAt, @closedAt)
`);

const insertAll = db.transaction((toInsert: SeedRequestRow[]) => {
  for (const row of toInsert) insertRequest.run(row);
});
insertAll(rows);

console.log(`Готово: ${CITIES.length} направлений, ${USERS.length} пользователей, ${rows.length} заявок → ${SEED_DB_PATH}`);
console.log('Пользователи seed-* — синтетические (нет реального MAX-аккаунта), это только данные для отчётов.');
console.log('Чтобы проверить /отчет живым директором: DB_PATH=data-seed.db pnpm dev:max');
console.log('— при старте бот сам назначит директором того, кто указан в .env как DIRECTOR_ID, уже в этой базе.');

db.close();
