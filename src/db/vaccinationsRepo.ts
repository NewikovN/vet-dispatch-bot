import { db } from './index.js';

export interface NewVaccination {
  city: string;
  vaccinationDate: string;
  vaccineType: string;
  animal: string;
  nextDate: string | null;
  clientContacts: string;
  createdBy: string;
}

export function createVaccination(data: NewVaccination): number {
  const stmt = db.prepare(`
    INSERT INTO vaccinations
      (city, vaccination_date, vaccine_type, animal, next_date, client_contacts, created_by, created_at)
    VALUES
      (@city, @vaccinationDate, @vaccineType, @animal, @nextDate, @clientContacts, @createdBy, @createdAt)
  `);
  const info = stmt.run({ ...data, createdAt: new Date().toISOString() });
  return Number(info.lastInsertRowid);
}

export interface VaccinationExportFilter {
  /** vaccination_date >= from (ISO-строка, включительно) */
  from?: string;
  /** vaccination_date <= to (ISO-строка, включительно) */
  to?: string;
  city?: string;
}

/** Строка для Excel-отчёта: вакцинация + имя добавившего (джойн с users). Контакты клиента ВКЛЮЧЕНЫ. */
export interface VaccinationExportRow {
  id: number;
  city: string;
  vaccinationDate: string;
  vaccineType: string;
  animal: string;
  nextDate: string | null;
  clientContacts: string;
  createdAt: string;
  createdByName: string | null;
}

/**
 * Фильтр — по vaccination_date (дате самой вакцинации), а не по created_at (дате записи в
 * базу). Для заявок отчёт логично фильтровать по созданию (когда завели заявку диспетчеру),
 * а для вакцинации важнее медицинское событие: директор спрашивает «сколько вакцинировали
 * в мае», а не «сколько записей вбили в мае» — запись обычно делается в тот же день, но не
 * обязана. Только чтение — атомарность не нужна. Параметры именованные, без конкатенации строк.
 */
export function listVaccinationsForExport(filter: VaccinationExportFilter = {}): VaccinationExportRow[] {
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filter.from) {
    conditions.push('v.vaccination_date >= @from');
    params.from = filter.from;
  }
  if (filter.to) {
    conditions.push('v.vaccination_date <= @to');
    params.to = filter.to;
  }
  if (filter.city) {
    conditions.push('v.city = @city');
    params.city = filter.city;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT v.*, u.display_name AS created_by_name
    FROM vaccinations v
    LEFT JOIN users u ON u.user_id = v.created_by
    ${where}
    ORDER BY v.vaccination_date
  `).all(params) as any[];

  return rows.map(toExportRow);
}

function toExportRow(row: any): VaccinationExportRow {
  return {
    id: row.id,
    city: row.city,
    vaccinationDate: row.vaccination_date,
    vaccineType: row.vaccine_type,
    animal: row.animal,
    nextDate: row.next_date,
    clientContacts: row.client_contacts,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null,
  };
}
