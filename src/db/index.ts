import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export const db = new Database(join(here, '../../data.db'));

const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
db.exec(schema);

console.log('База готова');