/**
 * scripts/migrate-vaccinations-workflow.ts — миграция ДЛЯ ПРОДА: переводит таблицу vaccinations
 * со старой структуры (city, vaccination_date, vaccine_type, animal, next_date, client_contacts,
 * created_by, created_at — без какого-либо жизненного цикла) на структуру requests: те же
 * служебные поля (статус с полным циклом open→taken→approved→closed/cancelled, кто принял, сумма
 * чека, id карточек в чатах, таймстампы) + address/problem/price_note, при этом vaccine_type и
 * next_date остаются собственными полями вакцинации. Колонка vaccination_date переименовывается
 * в date (то же имя, что у аналогичного поля заявки).
 *
 * Простым `ALTER TABLE ... ADD/RENAME COLUMN` тут не обойтись: нужен новый CHECK-constraint на
 * status, а SQLite не умеет менять CHECK через ALTER TABLE (та же причина, что в
 * migrate-add-cancelled-status.ts) — единственный официальный способ — пересобрать таблицу.
 *
 * ЗАБЭКФИЛЛЕНЫ старые записи статусом 'closed' (не 'open'): старый /вакцина сохранял запись сразу
 * целиком, без публикации в чат и без цикла принятия/одобрения — семантически это ближе к «уже
 * закрыто», чем к «свободно и ждёт врача» (последнее ввело бы в заблуждение — такая запись
 * никогда не была живой заявкой в рабочем чате). closed_at приблизительно взят как created_at
 * (реального момента «закрытия» для старых записей никогда не было). assigned_doctor_id,
 * check_amount, taken_at, approved_at, cancelled_at — NULL (для старых записей не применимо).
 * address/problem/price_note — '' (эти поля появляются только сейчас).
 *
 * Идемпотентна: если vaccinations.status уже есть — считаем, что миграция уже применена, ничего
 * не делаем. Перед пересборкой — резервная копия БД через db.backup() (SQLite Online Backup API,
 * НЕ fs.copyFileSync — база в режиме WAL) в файл с ISO-меткой времени в имени (повторные попытки
 * не должны стирать бэкап предыдущей), по образцу migrate-add-cancelled-status.ts /
 * migrate-add-address-column.ts. Если сам бэкап не удался — миграция прерывается, к пересборке не
 * переходим.
 *
 * На локальной копии (data.db в этом репозитории) на момент подготовки миграции — 0 строк в
 * vaccinations (проверено PRAGMA table_info + SELECT * FROM vaccinations перед написанием этого
 * скрипта). Реальные боевые данные на сервере агент не проверял — бэкап и осторожный backfill
 * рассчитаны на то, что там может быть непустая таблица.
 *
 * НЕ выполняется этим агентом на проде — только готовится. Запуск на сервере вручную,
 * ДО `pnpm build && systemctl restart vet-bot`, из корня проекта:
 *
 *   pnpm exec tsx scripts/migrate-vaccinations-workflow.ts
 *   (или с DB_PATH=путь/к/базе, если база не в стандартном месте)
 */
import Database from 'better-sqlite3';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const dbPath = resolve(projectRoot, process.env.DB_PATH ?? 'data.db');

console.log('Миграция vaccinations → жизненный цикл заявки: открываю', dbPath);

const db = new Database(dbPath);

const oldColumns = (db.prepare(`PRAGMA table_info(vaccinations)`).all() as Array<{ name: string }>).map(
  (c) => c.name,
);
const hasStatus = oldColumns.includes('status');

if (hasStatus) {
  console.log('Столбец status уже есть в vaccinations — миграция не нужна, ничего не делаю.');
} else {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.before-vaccinations-workflow-migration-${timestamp}.bak`;
  console.log('Резервная копия перед пересборкой:', backupPath);
  try {
    await db.backup(backupPath);
  } catch (err) {
    console.error(
      'ОШИБКА: не удалось сделать резервную копию — миграция прервана, таблицу vaccinations не трогал.',
      err,
    );
    process.exit(1);
  }
  console.log('Резервная копия готова.');

  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE vaccinations_new (
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
    `);

    db.exec(`
      INSERT INTO vaccinations_new
        (id, created_by, date, city, address, animal, problem, price_note, client_contacts,
         vaccine_type, next_date, status, assigned_doctor_id, check_amount, group_message_id,
         manage_message_id, created_at, taken_at, approved_at, closed_at, cancelled_at)
      SELECT
        id, created_by, vaccination_date, city, '' AS address, animal, '' AS problem,
        '' AS price_note, client_contacts, vaccine_type, next_date,
        'closed' AS status, NULL AS assigned_doctor_id, NULL AS check_amount,
        NULL AS group_message_id, NULL AS manage_message_id, created_at, NULL AS taken_at,
        NULL AS approved_at, created_at AS closed_at, NULL AS cancelled_at
      FROM vaccinations;
    `);

    db.exec(`DROP TABLE vaccinations;`);
    db.exec(`ALTER TABLE vaccinations_new RENAME TO vaccinations;`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vaccinations_status ON vaccinations(status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_vaccinations_city_date ON vaccinations(city, date);`);
  });

  // foreign_keys выключаем на время пересборки (та же причина и та же процедура, что в
  // migrate-add-cancelled-status.ts) и проверяем целостность после — PRAGMA не переключить внутри
  // самой транзакции.
  db.pragma('foreign_keys = OFF');
  rebuild();
  const fkErrors = db.pragma('foreign_key_check');
  if (Array.isArray(fkErrors) && fkErrors.length > 0) {
    console.error('ОШИБКА: нарушения внешних ключей после пересборки:', fkErrors);
    process.exitCode = 1;
  } else {
    console.log(
      "Готово: vaccinations переведена на структуру requests (жизненный цикл, address/problem/price_note); " +
        "старые записи получили статус 'closed'.",
    );
  }
  db.pragma('foreign_keys = ON');
}

db.close();
