/**
 * Общая механика атомарных переходов статуса — один и тот же SQL-паттерн
 * (UPDATE ... WHERE status = '...') нужен и requests, и vaccinations (после того как вакцинация
 * получила тот же жизненный цикл, что заявка): open → taken → approved → closed, либо
 * open → cancelled. Таблицы физически ОСТАЮТСЯ раздельными (жёсткое требование заказчика — не
 * сливать requests и vaccinations в одну) — этот модуль не хранение, а переиспользуемая логика
 * переходов, параметризованная именем таблицы.
 *
 * Имя таблицы — литерал из закрытого списка (WorkflowTable), не пользовательский ввод: оба
 * вызывающих места (requestsRepo.ts/vaccinationsRepo.ts) передают жёстко зашитую строку, поэтому
 * интерполяция в SQL безопасна. Тип ограничивает вызовы только двумя известными таблицами.
 *
 * requestsRepo.ts/vaccinationsRepo.ts оборачивают эти функции в свои claimRequest/approveRequest/
 * rejectRequest/cancelRequest/closeRequest/returnRequestToWork (и аналогично claimVaccination/...)
 * с предметными именами — наружу из бота эти функции (claim/approve/reject/cancel/close/
 * returnToWork) напрямую не зовутся, это внутренняя переиспользуемая деталь репозиториев.
 */
import { db } from './index.js';

export type WorkflowTable = 'requests' | 'vaccinations';

export type ClaimResult = 'ok' | 'already_taken' | 'not_found';
export type ApproveResult = 'ok' | 'not_taken' | 'not_found';
export type RejectResult = 'ok' | 'not_taken' | 'not_found';
export type CancelResult = 'ok' | 'not_open' | 'not_found';
export type CloseResult = 'ok' | 'not_approved' | 'wrong_doctor' | 'not_found';
export type ReturnToWorkResult = 'ok' | 'not_approved' | 'not_found';

interface StatusRow {
  status: string;
  assigned_doctor_id: string | null;
}

function getStatusRow(table: WorkflowTable, id: number): StatusRow | null {
  const row = db.prepare(`SELECT status, assigned_doctor_id FROM ${table} WHERE id = ?`).get(id) as
    | StatusRow
    | undefined;
  return row ?? null;
}

/** Захват: врач принял → 'open' → 'taken'. */
export function claim(table: WorkflowTable, id: number, doctorId: string): ClaimResult {
  const info = db
    .prepare(
      `
      UPDATE ${table}
      SET status = 'taken', assigned_doctor_id = ?, taken_at = ?
      WHERE id = ? AND status = 'open'
    `,
    )
    .run(doctorId, new Date().toISOString(), id);

  if (info.changes === 1) return 'ok';
  return getStatusRow(table, id) ? 'already_taken' : 'not_found';
}

/** Одобрение: 'taken' → 'approved'. */
export function approve(table: WorkflowTable, id: number): ApproveResult {
  const info = db
    .prepare(
      `
      UPDATE ${table}
      SET status = 'approved', approved_at = ?
      WHERE id = ? AND status = 'taken'
    `,
    )
    .run(new Date().toISOString(), id);

  if (info.changes === 1) return 'ok';
  return getStatusRow(table, id) ? 'not_taken' : 'not_found';
}

/** Отклонение приёма: 'taken' → 'open' (снова свободна), захват сбрасывается. */
export function reject(table: WorkflowTable, id: number): RejectResult {
  const info = db
    .prepare(
      `
      UPDATE ${table}
      SET status = 'open', assigned_doctor_id = NULL, taken_at = NULL
      WHERE id = ? AND status = 'taken'
    `,
    )
    .run(id);

  if (info.changes === 1) return 'ok';
  return getStatusRow(table, id) ? 'not_taken' : 'not_found';
}

/** Отмена ОТКРЫТОЙ (ещё не принятой) записи: 'open' → 'cancelled'. */
export function cancel(table: WorkflowTable, id: number): CancelResult {
  const info = db
    .prepare(
      `
      UPDATE ${table}
      SET status = 'cancelled', cancelled_at = ?
      WHERE id = ? AND status = 'open'
    `,
    )
    .run(new Date().toISOString(), id);

  if (info.changes === 1) return 'ok';
  return getStatusRow(table, id) ? 'not_open' : 'not_found';
}

/**
 * Форс-мажор: одобренную запись вернуть в работу — 'approved' → 'open', снятие врача.
 * Симметрично reject ('taken' → 'open'), только с другого предусловия и дополнительно сбрасывает
 * approved_at. НЕ новый статус — запись просто возвращается в уже существующий 'open' и живёт
 * по тем же правилам, что и свежесозданная (снова доступна кнопка «Принять» любому врачу).
 */
export function returnToWork(table: WorkflowTable, id: number): ReturnToWorkResult {
  const info = db
    .prepare(
      `
      UPDATE ${table}
      SET status = 'open', assigned_doctor_id = NULL, taken_at = NULL, approved_at = NULL
      WHERE id = ? AND status = 'approved'
    `,
    )
    .run(id);

  if (info.changes === 1) return 'ok';
  return getStatusRow(table, id) ? 'not_approved' : 'not_found';
}

/** Закрытие: 'approved' → 'closed', только тем же врачом, что принял. */
export function close(table: WorkflowTable, id: number, doctorId: string, checkAmount: number): CloseResult {
  const info = db
    .prepare(
      `
      UPDATE ${table}
      SET status = 'closed', check_amount = ?, closed_at = ?
      WHERE id = ? AND status = 'approved' AND assigned_doctor_id = ?
    `,
    )
    .run(checkAmount, new Date().toISOString(), id, doctorId);

  if (info.changes === 1) return 'ok';

  const row = getStatusRow(table, id);
  if (!row) return 'not_found';
  if (row.assigned_doctor_id !== doctorId) return 'wrong_doctor';
  return 'not_approved';
}
