import { db } from './index.js';

export interface CityChats {
  city: string;
  workChatId: string | null;
  manageChatId: string | null;
}

/** Задать оба чата города сразу */
export function setCityChats(city: string, workChatId: string, manageChatId: string): void {
  db.prepare(`
    INSERT INTO city_chats (city, work_chat_id, manage_chat_id)
    VALUES (@city, @workChatId, @manageChatId)
    ON CONFLICT(city) DO UPDATE SET
      work_chat_id = excluded.work_chat_id,
      manage_chat_id = excluded.manage_chat_id
  `).run({ city, workChatId, manageChatId });
}

/** Привязать рабочий чат города, не трогая управленческий (если его ещё нет — строка создаётся с ним = NULL) */
export function setWorkChat(city: string, chatId: string): void {
  db.prepare(`
    INSERT INTO city_chats (city, work_chat_id)
    VALUES (@city, @chatId)
    ON CONFLICT(city) DO UPDATE SET work_chat_id = excluded.work_chat_id
  `).run({ city, chatId });
}

/** Привязать управленческий чат города, не трогая рабочий (если его ещё нет — строка создаётся с ним = NULL) */
export function setManageChat(city: string, chatId: string): void {
  db.prepare(`
    INSERT INTO city_chats (city, manage_chat_id)
    VALUES (@city, @chatId)
    ON CONFLICT(city) DO UPDATE SET manage_chat_id = excluded.manage_chat_id
  `).run({ city, chatId });
}

export function getCityChats(city: string): CityChats | null {
  const row = db.prepare('SELECT * FROM city_chats WHERE city = ?').get(city) as any;
  return row ? toCityChats(row) : null;
}

export function listCityChats(): CityChats[] {
  const rows = db.prepare('SELECT * FROM city_chats ORDER BY city').all() as any[];
  return rows.map(toCityChats);
}

function toCityChats(row: any): CityChats {
  return {
    city: row.city,
    workChatId: row.work_chat_id,
    manageChatId: row.manage_chat_id,
  };
}
