export type Role = 'dispatcher' | 'doctor' | 'manager' | 'director';
export type UserStatus = 'active' | 'removed';

/**
 * Общий набор статусов жизненного цикла — один и тот же для заявок и (после переноса на общую
 * механику) вакцинаций: open → taken → approved → closed, либо open → cancelled. `RequestStatus` —
 * алиас для обратной совместимости с местами, где тип уже назывался так (requestsRepo.ts).
 */
export type WorkflowStatus = 'open' | 'taken' | 'approved' | 'closed' | 'cancelled';
export type RequestStatus = WorkflowStatus;

export interface User {
  userId: string;
  displayName: string;
  role: Role | null;
  status: UserStatus;
  dmChatId: string | null;
  createdAt: string;
}

export interface Request {
  id: number;
  createdBy: string;
  date: string;
  city: string;
  /** Адрес выезда БЕЗ номера квартиры/офиса — его видят все врачи ещё до принятия заявки. */
  address: string;
  animal: string;
  problem: string;
  priceNote: string;
  clientContacts: string;
  status: RequestStatus;
  assignedDoctorId: string | null;
  checkAmount: number | null;
  groupMessageId: string | null;
  manageMessageId: string | null;
  createdAt: string;
  takenAt: string | null;
  /** Раньше не маппилось из БД в домен, хотя колонка approved_at существует с самого начала — добавлено попутно. */
  approvedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
}

/**
 * Вакцинация — та же структура служебных полей, что и заявка (включая жизненный цикл
 * open → taken → approved → closed/cancelled, кто принял, суммa чека, id карточек в чатах), плюс
 * два собственных поля: какая вакцина и дата следующей вакцинации. Таблица в БД остаётся
 * ОТДЕЛЬНОЙ от requests (жёсткое требование заказчика) — общая только механика статусов
 * (см. db/workflowRepo.ts), не хранение.
 */
export interface Vaccination {
  id: number;
  createdBy: string;
  date: string;
  city: string;
  address: string;
  animal: string;
  problem: string;
  priceNote: string;
  clientContacts: string;
  /** Какая вакцина — собственное поле, не из заявки. */
  vaccineType: string;
  /** Дата следующей вакцинации — собственное поле, не из заявки. Может быть не указана. */
  nextDate: string | null;
  status: WorkflowStatus;
  assignedDoctorId: string | null;
  checkAmount: number | null;
  groupMessageId: string | null;
  manageMessageId: string | null;
  createdAt: string;
  takenAt: string | null;
  approvedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
}

export function canCreateRequest(role: Role | null): boolean {
  return role === 'dispatcher' || role === 'manager' || role === 'director';
}

export function canTakeRequest(role: Role | null): boolean {
  return role === 'doctor';
}

export function canManageRoles(role: Role | null): boolean {
  return role === 'director';
}

export function canApprove(role: Role | null): boolean {
  return role === 'director' || role === 'manager' || role === 'dispatcher';
}

export function canReject(role: Role | null): boolean {
  return role === 'director' || role === 'manager' || role === 'dispatcher';
}

export function canSeeDetails(role: Role | null): boolean {
  return role === 'director' || role === 'manager' || role === 'dispatcher';
}

/** Отменить можно только ОТКРЫТУЮ (ещё не принятую врачом) заявку — та же роль, что и создаёт. */
export function canCancel(role: Role | null): boolean {
  return role === 'director' || role === 'manager' || role === 'dispatcher';
}

/** Учёт вакцинаций — отдельная сущность, не связанная с заявками. Ведут директор и управляющий. */
export function canManageVaccinations(role: Role | null): boolean {
  return role === 'director' || role === 'manager';
}