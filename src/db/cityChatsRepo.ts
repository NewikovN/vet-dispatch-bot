import { db } from './index.js';

export interface CityChats {
  city: string;
  workChatId: string;
  manageChatId: string;
}

export function setCityChats(city: string, workChatId: string, manageChatId: string): void {
  db.prepare(`
    INSERT INTO city_chats (city, work_chat_id, manage_chat_id)
    VALUES (@city, @workChatId, @manageChatId)
    ON CONFLICT(city) DO UPDATE SET
      work_chat_id = excluded.work_chat_id,
      manage_chat_id = excluded.manage_chat_id
  `).run({ city, workChatId, manageChatId });
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