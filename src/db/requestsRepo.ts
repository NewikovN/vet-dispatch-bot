import { db } from './index.js';
import type { Request } from '../domain/models.js';

export interface NewRequest {
  createdBy: string;
  date: string;
  city: string;
  animal: string;
  problem: string;
  priceNote: string;
  clientContacts: string;
}

export function createRequest(data: NewRequest): number {
  const stmt = db.prepare(`
    INSERT INTO requests
      (created_by, date, city, animal, problem, price_note, client_contacts, created_at)
    VALUES
      (@createdBy, @date, @city, @animal, @problem, @priceNote, @clientContacts, @createdAt)
  `);
  const info = stmt.run({ ...data, createdAt: new Date().toISOString() });
  return Number(info.lastInsertRowid);
}

export function getRequest(id: number): Request | null {
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as any;
  return row ? toRequest(row) : null;
}

export function setGroupMessageId(id: number, messageId: string): void {
  db.prepare('UPDATE requests SET group_message_id = ? WHERE id = ?').run(messageId, id);
}

export function setManageMessageId(id: number, messageId: string): void {
  db.prepare('UPDATE requests SET manage_message_id = ? WHERE id = ?').run(messageId, id);
}

function toRequest(row: any): Request {
  return {
    id: row.id,
    createdBy: row.created_by,
    date: row.date,
    city: row.city,
    animal: row.animal,
    problem: row.problem,
    priceNote: row.price_note,
    clientContacts: row.client_contacts,
    status: row.status,
    assignedDoctorId: row.assigned_doctor_id,
    checkAmount: row.check_amount,
    groupMessageId: row.group_message_id,
    manageMessageId: row.manage_message_id,
    createdAt: row.created_at,
    takenAt: row.taken_at,
    closedAt: row.closed_at,
  };
}

export type ClaimResult = 'ok' | 'already_taken' | 'not_found';

export function claimRequest(id: number, doctorId: string): ClaimResult {
  const info = db.prepare(`
    UPDATE requests
    SET status = 'taken', assigned_doctor_id = ?, taken_at = ?
    WHERE id = ? AND status = 'open'
  `).run(doctorId, new Date().toISOString(), id);

  if (info.changes === 1) return 'ok';
  return getRequest(id) ? 'already_taken' : 'not_found';
}

export type CloseResult = 'ok' | 'not_approved' | 'wrong_doctor' | 'not_found';

export function closeRequest(id: number, doctorId: string, checkAmount: number): CloseResult {
  const info = db.prepare(`
    UPDATE requests
    SET status = 'closed', check_amount = ?, closed_at = ?
    WHERE id = ? AND status = 'approved' AND assigned_doctor_id = ?
  `).run(checkAmount, new Date().toISOString(), id, doctorId);

  if (info.changes === 1) return 'ok';

  const req = getRequest(id);
  if (!req) return 'not_found';
  if (req.assignedDoctorId !== doctorId) return 'wrong_doctor';
  return 'not_approved';
}

export type ApproveResult = 'ok' | 'not_taken' | 'not_found';

export function approveRequest(id: number): ApproveResult {
  const info = db.prepare(`
    UPDATE requests
    SET status = 'approved', approved_at = ?
    WHERE id = ? AND status = 'taken'
  `).run(new Date().toISOString(), id);

  if (info.changes === 1) return 'ok';
  return getRequest(id) ? 'not_taken' : 'not_found';
}

export type RejectResult = 'ok' | 'not_taken' | 'not_found';

export function rejectRequest(id: number): RejectResult {
  const info = db.prepare(`
    UPDATE requests
    SET status = 'open', assigned_doctor_id = NULL, taken_at = NULL
    WHERE id = ? AND status = 'taken'
  `).run(id);

  if (info.changes === 1) return 'ok';
  return getRequest(id) ? 'not_taken' : 'not_found';
}