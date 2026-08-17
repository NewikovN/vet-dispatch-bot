import { db } from './src/db/index.js';
import { createRequest, claimRequest, getRequest } from './src/db/requestsRepo.js';

// Подготовка: чистим и заводим врачей
db.exec(`DELETE FROM requests; DELETE FROM users;`);
const now = new Date().toISOString();
db.prepare(`INSERT INTO users (user_id, role, created_at) VALUES (?, 'dispatcher', ?)`).run('disp1', now);
db.prepare(`INSERT INTO users (user_id, role, created_at) VALUES (?, 'doctor', ?)`).run('doc1', now);
db.prepare(`INSERT INTO users (user_id, role, created_at) VALUES (?, 'doctor', ?)`).run('doc2', now);

const id = createRequest({
  createdBy: 'disp1',
  date: '2026-07-16',
  city: 'Владимир',
  address: 'ул. Тестовая, 1',
  animal: 'Кот',
  problem: 'Не ест',
  priceNote: 'Осмотр 1500',
  clientContacts: 'Иван, +79001234567',
});

// Гонка: два врача жмут «Принять»
const first = claimRequest(id, 'doc1');
const second = claimRequest(id, 'doc2');

console.log('Врач 1:', first);
console.log('Врач 2:', second);

const req = getRequest(id);
console.log('Заявка у:', req?.assignedDoctorId, '| статус:', req?.status);

const ok = first === 'ok' && second === 'already_taken' && req?.assignedDoctorId === 'doc1';
console.log(ok ? '✅ ТЕСТ ПРОЙДЕН' : '❌ ТЕСТ ПРОВАЛЕН');