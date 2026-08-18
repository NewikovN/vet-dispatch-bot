import { db } from './index.js';
import type { Vaccination } from '../domain/models.js';
import {
  claim,
  approve,
  reject,
  cancel,
  close,
  returnToWork,
  type ClaimResult,
  type ApproveResult,
  type RejectResult,
  type CancelResult,
  type CloseResult,
  type ReturnToWorkResult,
} from './workflowRepo.js';

/** Те же поля, что у заявки (NewRequest), плюс два собственных: vaccineType, nextDate. */
export interface NewVaccination {
  createdBy: string;
  date: string;
  city: string;
  address: string;
  animal: string;
  problem: string;
  priceNote: string;
  clientContacts: string;
  vaccineType: string;
  nextDate: string | null;
}

export function createVaccination(data: NewVaccination): number {
  const stmt = db.prepare(`
    INSERT INTO vaccinations
      (created_by, date, city, address, animal, problem, price_note, client_contacts, vaccine_type, next_date, created_at)
    VALUES
      (@createdBy, @date, @city, @address, @animal, @problem, @priceNote, @clientContacts, @vaccineType, @nextDate, @createdAt)
  `);
  const info = stmt.run({ ...data, createdAt: new Date().toISOString() });
  return Number(info.lastInsertRowid);
}

export function getVaccination(id: number): Vaccination | null {
  const row = db.prepare('SELECT * FROM vaccinations WHERE id = ?').get(id) as any;
  return row ? toVaccination(row) : null;
}

/**
 * Найти запись о вакцинации по id сообщения-карточки — та же причина, что у
 * requestsRepo.findRequestByMessageId (см. там): нужно отличить кнопку вакцинации от кнопки
 * заявки в message_callback, независимые последовательности id голым числом не различить.
 */
export function findVaccinationByMessageId(messageId: string): Vaccination | null {
  const row = db
    .prepare('SELECT * FROM vaccinations WHERE group_message_id = ? OR manage_message_id = ?')
    .get(messageId, messageId) as any;
  return row ? toVaccination(row) : null;
}

export function setGroupMessageId(id: number, messageId: string): void {
  db.prepare('UPDATE vaccinations SET group_message_id = ? WHERE id = ?').run(messageId, id);
}

export function setManageMessageId(id: number, messageId: string): void {
  db.prepare('UPDATE vaccinations SET manage_message_id = ? WHERE id = ?').run(messageId, id);
}

function toVaccination(row: any): Vaccination {
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
    vaccineType: row.vaccine_type,
    nextDate: row.next_date,
    status: row.status,
    assignedDoctorId: row.assigned_doctor_id,
    checkAmount: row.check_amount,
    groupMessageId: row.group_message_id,
    manageMessageId: row.manage_message_id,
    createdAt: row.created_at,
    takenAt: row.taken_at,
    approvedAt: row.approved_at,
    closedAt: row.closed_at,
    cancelledAt: row.cancelled_at,
  };
}

// Атомарные переходы статуса — общая механика с requests, см. workflowRepo.ts. Тонкие обёртки с
// предметными именами, по аналогии с requestsRepo.ts (claimRequest/approveRequest/...).
export type { ClaimResult, ApproveResult, RejectResult, CancelResult, CloseResult, ReturnToWorkResult };

export function claimVaccination(id: number, doctorId: string): ClaimResult {
  return claim('vaccinations', id, doctorId);
}

export function approveVaccination(id: number): ApproveResult {
  return approve('vaccinations', id);
}

export function rejectVaccination(id: number): RejectResult {
  return reject('vaccinations', id);
}

/** Отменить можно только ОТКРЫТУЮ (ещё не принятую врачом) запись — статус 'open' → 'cancelled'. */
export function cancelVaccination(id: number): CancelResult {
  return cancel('vaccinations', id);
}

export function closeVaccination(id: number, doctorId: string, checkAmount: number): CloseResult {
  return close('vaccinations', id, doctorId, checkAmount);
}

/** Форс-мажор: вернуть ОДОБРЕННУЮ запись в работу — статус 'approved' → 'open', снятие врача. */
export function returnVaccinationToWork(id: number): ReturnToWorkResult {
  return returnToWork('vaccinations', id);
}

export interface VaccinationExportFilter {
  /** vaccination_date (колонка date) >= from (ISO-строка, включительно) */
  from?: string;
  /** vaccination_date (колонка date) <= to (ISO-строка, включительно) */
  to?: string;
  city?: string;
}

/**
 * Строка для Excel-отчёта: вакцинация + имя добавившего (джойн с users по created_by) + имя
 * врача, закрывшего запись (джойн с users по assigned_doctor_id), + сумма чека. Контакты клиента
 * ВКЛЮЧЕНЫ (в отличие от заявок). Имена полей здесь намеренно НЕ переименованы вслед за
 * колонкой `date` в БД (осталось `vaccinationDate`) — это отчётный, а не доменный тип, его
 * трогает domain/exportService.ts, который в этом подшаге не меняем.
 */
export interface VaccinationExportRow {
  id: number;
  city: string;
  vaccinationDate: string;
  vaccineType: string;
  animal: string;
  nextDate: string | null;
  doctorName: string | null;
  checkAmount: number | null;
  clientContacts: string;
  createdAt: string;
  createdByName: string | null;
}

/**
 * Фильтр — по дате самой вакцинации (колонка `date`), а не по created_at (дате записи в базу).
 * Для заявок отчёт логично фильтровать по созданию (когда завели заявку диспетчеру), а для
 * вакцинации важнее медицинское событие: директор спрашивает «сколько вакцинировали в мае», а не
 * «сколько записей вбили в мае» — запись обычно делается в тот же день, но не обязана. Только
 * чтение — атомарность не нужна. Параметры именованные, без конкатенации строк.
 *
 * В отчёт попадают ТОЛЬКО закрытые (`closed`) записи — тот же принцип, что и в
 * listRequestsForExport (requestsRepo.ts): условие безусловное, не зависит от остальных
 * фильтров и всегда действует в паре с ними через AND. В БД по-прежнему хранятся записи всех
 * статусов (боту они нужны в работе, полный жизненный цикл, как у заявки) — фильтрация только
 * на этапе экспорта.
 */
export function listVaccinationsForExport(filter: VaccinationExportFilter = {}): VaccinationExportRow[] {
  const conditions: string[] = [`v.status = 'closed'`];
  const params: Record<string, string> = {};

  if (filter.from) {
    conditions.push('v.date >= @from');
    params.from = filter.from;
  }
  if (filter.to) {
    conditions.push('v.date <= @to');
    params.to = filter.to;
  }
  if (filter.city) {
    conditions.push('v.city = @city');
    params.city = filter.city;
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const rows = db.prepare(`
    SELECT v.*, u.display_name AS created_by_name, d.display_name AS doctor_name
    FROM vaccinations v
    LEFT JOIN users u ON u.user_id = v.created_by
    LEFT JOIN users d ON d.user_id = v.assigned_doctor_id
    ${where}
    ORDER BY v.date
  `).all(params) as any[];

  return rows.map(toExportRow);
}

function toExportRow(row: any): VaccinationExportRow {
  return {
    id: row.id,
    city: row.city,
    vaccinationDate: row.date,
    vaccineType: row.vaccine_type,
    animal: row.animal,
    nextDate: row.next_date,
    doctorName: row.doctor_name ?? null,
    checkAmount: row.check_amount,
    clientContacts: row.client_contacts,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
  };
}
