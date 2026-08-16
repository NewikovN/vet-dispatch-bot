export type Role = 'dispatcher' | 'doctor' | 'manager' | 'director';
export type UserStatus = 'active' | 'removed';
export type RequestStatus = 'open' | 'taken' | 'approved' | 'closed';

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
  closedAt: string | null;
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
  return role === 'director' || role === 'manager';
}

export function canReject(role: Role | null): boolean {
  return role === 'director' || role === 'manager';
}

export function canSeeDetails(role: Role | null): boolean {
  return role === 'director' || role === 'manager' || role === 'dispatcher';
}

/** Учёт вакцинаций — отдельная сущность, не связанная с заявками. Ведут директор и управляющий. */
export function canManageVaccinations(role: Role | null): boolean {
  return role === 'director' || role === 'manager';
}