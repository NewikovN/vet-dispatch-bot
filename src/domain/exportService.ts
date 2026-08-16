import ExcelJS from 'exceljs';
import { listRequestsForExport, type ExportFilter } from '../db/requestsRepo.js';
import { listVaccinationsForExport, type VaccinationExportFilter } from '../db/vaccinationsRepo.js';
import { toRubles } from './money.js';
import { formatMsk } from './datetime.js';

const STATUS_LABELS: Record<string, string> = {
  open: 'Свободна',
  taken: 'В работе (не одобрено)',
  approved: 'В работе (одобрено)',
  closed: 'Закрыта',
};

/**
 * Генерация Excel-отчёта по заявкам. Платформо-независимо: ничего не знает про MAX/VK,
 * не импортирует из adapters/. Вызывающая сторона (адаптер) сама решает, как доставить Buffer.
 *
 * Контакты клиента в отчёт намеренно НЕ включены — это чувствительные данные, для сводной
 * выгрузки директору не нужны. Если понадобятся — добавим отдельным явным полем по запросу.
 */
export async function generateRequestsXlsx(filter: ExportFilter = {}): Promise<Buffer> {
  const rows = listRequestsForExport(filter);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Заявки');

  sheet.columns = [
    { header: '№', key: 'id', width: 8 },
    { header: 'Дата создания', key: 'createdAt', width: 20 },
    { header: 'Направление', key: 'city', width: 20 },
    { header: 'Животное', key: 'animal', width: 20 },
    { header: 'Проблема', key: 'problem', width: 32 },
    { header: 'Оговорено по цене', key: 'priceNote', width: 22 },
    { header: 'Статус', key: 'status', width: 22 },
    { header: 'Врач', key: 'doctorName', width: 20 },
    { header: 'Сумма чека, ₽', key: 'checkAmount', width: 15 },
    { header: 'Принята', key: 'takenAt', width: 20 },
    { header: 'Одобрена', key: 'approvedAt', width: 20 },
    { header: 'Закрыта', key: 'closedAt', width: 20 },
  ];

  sheet.getRow(1).font = { bold: true };

  for (const r of rows) {
    sheet.addRow({
      id: r.id,
      createdAt: formatMsk(r.createdAt),
      city: r.city,
      animal: r.animal,
      problem: r.problem,
      priceNote: r.priceNote,
      status: STATUS_LABELS[r.status] ?? r.status,
      doctorName: r.doctorName ?? '',
      checkAmount: r.checkAmount != null ? toRubles(r.checkAmount) : null,
      takenAt: formatMsk(r.takenAt),
      approvedAt: formatMsk(r.approvedAt),
      closedAt: formatMsk(r.closedAt),
    });
  }

  sheet.getColumn('checkAmount').numFmt = '#,##0.00';

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Генерация Excel-отчёта по вакцинациям. Отдельная сущность, не связана с заявками.
 * В отличие от отчёта по заявкам — контакты клиента здесь ВКЛЮЧЕНЫ: запись о вакцинации без
 * контактов бесполезна (директору нужно понимать, кого именно и как найти на ревакцинацию).
 */
export async function generateVaccinationsXlsx(filter: VaccinationExportFilter = {}): Promise<Buffer> {
  const rows = listVaccinationsForExport(filter);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Вакцинации');

  sheet.columns = [
    { header: '№', key: 'id', width: 8 },
    { header: 'Дата вакцинации', key: 'vaccinationDate', width: 20 },
    { header: 'Направление', key: 'city', width: 20 },
    { header: 'Вакцина', key: 'vaccineType', width: 20 },
    { header: 'Кого вакцинировали', key: 'animal', width: 24 },
    { header: 'Следующая дата', key: 'nextDate', width: 20 },
    { header: 'Контакты клиента', key: 'clientContacts', width: 26 },
    { header: 'Дата записи', key: 'createdAt', width: 20 },
    { header: 'Кто добавил', key: 'createdByName', width: 20 },
  ];

  sheet.getRow(1).font = { bold: true };

  for (const r of rows) {
    sheet.addRow({
      id: r.id,
      vaccinationDate: formatMsk(r.vaccinationDate),
      city: r.city,
      vaccineType: r.vaccineType,
      animal: r.animal,
      nextDate: formatMsk(r.nextDate),
      clientContacts: r.clientContacts,
      createdAt: formatMsk(r.createdAt),
      createdByName: r.createdByName ?? '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
