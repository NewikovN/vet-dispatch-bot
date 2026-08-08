import { db } from './index.js';
import type { User, Role } from '../domain/models.js';

export function getUser(userId: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as any;
  return row ? toUser(row) : null;
}

export function ensureUser(userId: string, displayName: string): User {
  db.prepare(`
    INSERT INTO users (user_id, display_name, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name
  `).run(userId, displayName, new Date().toISOString());
  return getUser(userId)!;
}

export function setDmChatId(userId: string, dmChatId: string): void {
  db.prepare('UPDATE users SET dm_chat_id = ? WHERE user_id = ?').run(dmChatId, userId);
}

export function setRole(userId: string, role: Role): void {
  db.prepare('UPDATE users SET role = ?, status = \'active\' WHERE user_id = ?').run(role, userId);
}

export function removeUser(userId: string): void {
  db.prepare('UPDATE users SET status = \'removed\' WHERE user_id = ?').run(userId);
}

export function listActiveUsers(): User[] {
  const rows = db.prepare("SELECT * FROM users WHERE status = 'active' ORDER BY role, display_name").all() as any[];
  return rows.map(toUser);
}

function toUser(row: any): User {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    dmChatId: row.dm_chat_id,
    createdAt: row.created_at,
  };
}