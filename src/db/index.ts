import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Путь к БД можно переопределить через DB_PATH — например, чтобы временно направить бота
// на тестовую базу (data-seed.db), не трогая рабочую. По умолчанию — рабочая data.db в корне проекта.
const dbPath = process.env.DB_PATH ? resolve(process.env.DB_PATH) : join(here, '../../data.db');

export const db = new Database(dbPath);

const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
db.exec(schema);

console.log('База готова:', dbPath);
