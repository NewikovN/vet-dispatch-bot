#!/usr/bin/env node
/**
 * Копирует не-.ts ассеты, нужные в рантайме, из src/ в dist/ после сборки — tsc компилирует
 * только .ts и сам ничего больше не копирует. Единственный такой ассет сейчас — db/schema.sql
 * (db/index.ts читает его рядом с собой через import.meta.url, поэтому после копирования в
 * dist/db/schema.sql путь сходится без изменений в коде). Новые .sql-файлы в src/db подхватятся
 * автоматически (копируется всё с расширением .sql, а не поимённо).
 *
 * Плейн Node (fs/path из стандартной библиотеки, без cp/mkdir -p из шелла) — одинаково
 * работает и на сервере Ubuntu, и локально на Mac, не зависит от доступности shell-утилит.
 */
import { readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDb = join(projectRoot, 'src', 'db');
const distDb = join(projectRoot, 'dist', 'db');

mkdirSync(distDb, { recursive: true });

const sqlFiles = readdirSync(srcDb).filter((f) => f.endsWith('.sql'));

for (const file of sqlFiles) {
  copyFileSync(join(srcDb, file), join(distDb, file));
  console.log(`Скопирован ассет: db/${file} → dist/db/${file}`);
}

if (sqlFiles.length === 0) {
  console.warn('ВНИМАНИЕ: в src/db не найдено .sql-файлов — schema.sql не попадёт в dist, прод не запустится.');
  process.exitCode = 1;
}
