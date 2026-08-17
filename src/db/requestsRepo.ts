import { db } from './index.js';
import type { Request, RequestStatus } from '../domain/models.js';

export interface NewRequest {
  createdBy: string;
  date: string;
  city: string;
  address: string;
  animal: string;
  problem: string;
  priceNote: string;
  clientContacts: string;
}

export function createRequest(data: NewRequest): number {
  const stmt = db.prepare(`
    INSERT INTO requests
      (created_by, date, city, address, animal, problem, price_note, client_contacts, created_at)
    VALUES
      (@createdBy, @date, @city, @address, @animal, @problem, @priceNote, @clientContacts, @createdAt)
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
    address: row.address,
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

export interface ExportFilter {
  /** created_at >= from (ISO-строка, включительно) */
  from?: string;
  /** created_at <= to (ISO-строка, включительно) */
  to?: string;
  city?: string;
}

/** Строка для Excel-отчёта: заявка + имя принявшего врача (джойн с users). Без контактов клиента. */
export interface ExportRow {
  id: number;
  createdAt: string;
  city: string;
  animal: string;
  problem: string;
  priceNote: string;
  status: RequestStatus;
  doctorName: string | null;
  checkAmount: number | null;
  takenAt: string | null;
  approvedAt: string | null;
  closedAt: string | null;
}

/**
 * Только чтение — атомарность здесь не нужна (не меняет состояние). Параметры именованные — без
 * конкатенации строк.
 *
 * В отчёт попадают ТОЛЬКО закрытые (`closed`) заявки — условие безусловное, не зависит от
 * остальных фильтров и всегда действует в паре с ними через AND. В БД по-прежнему хранятся
 * заявки во всех статусах (боту они нужны в работе) — фильтрация только на этапе экспорта.
 */
export function listRequestsForExport(filter: ExportFilter = {}): ExportRow[] {
  const conditions: string[] = [`r.status = 'closed'`];
  const params: Record<string, string> = {};

  if (filter.from) {
    conditions.push('r.created_at >= @from');
    params.from = filter.from;
  }
  if (filter.to) {
    conditions.push('r.created_at <= @to');
    params.to = filter.to;
  }
  if (filter.city) {
    conditions.push('r.city = @city');
    params.city = filter.city;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT r.*, u.display_name AS doctor_name
    FROM requests r
    LEFT JOIN users u ON u.user_id = r.assigned_doctor_id
    ${where}
    ORDER BY r.created_at
  `).all(params) as any[];

  return rows.map(toExportRow);
}

function toExportRow(row: any): ExportRow {
  return {
    id: row.id,
    createdAt: row.created_at,
    city: row.city,
    animal: row.animal,
    problem: row.problem,
    priceNote: row.price_note,
    status: row.status,
    doctorName: row.doctor_name ?? null,
    checkAmount: row.check_amount,
    takenAt: row.taken_at,
    approvedAt: row.approved_at,
    closedAt: row.closed_at,
  };
}