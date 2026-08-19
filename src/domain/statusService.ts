/**
 * Сводка активных заявок/вакцинаций (/статус, только директор). Текст собирается здесь,
 * а не в handlers.ts, — та же граница, что у остальных доменных сервисов: что считать
 * «активным» и как это сгруппировать — бизнес-правило, не деталь транспорта.
 */
import { listActiveRequests } from '../db/requestsRepo.js';
import { listActiveVaccinations } from '../db/vaccinationsRepo.js';

interface ActiveEntry {
  id: number;
  city: string;
}

function splitByStatus(
  items: { id: number; status: string; city: string }[],
): { open: ActiveEntry[]; inWork: ActiveEntry[] } {
  const open: ActiveEntry[] = [];
  const inWork: ActiveEntry[] = [];
  for (const item of items) {
    const entry = { id: item.id, city: item.city };
    if (item.status === 'open') open.push(entry);
    else if (item.status === 'taken' || item.status === 'approved') inWork.push(entry);
  }
  return { open, inWork };
}

/**
 * Нумерация сквозная по всем городам — рядом с номером указываем город, иначе не понять, в
 * каком чате искать. Город после номера БЕЗ скобок — так явно попросил заказчик.
 */
function formatEntries(entries: ActiveEntry[]): string {
  return entries.map((e) => `№${e.id} ${e.city}`).join(', ');
}

/**
 * Заявки и вакцинации показываются вместе, в одном сообщении, но разными блоками — так проще
 * сразу отличить, где заявка, а где вакцинация, чем в общем списке с пометкой типа у каждого
 * номера. Пустой блок (например, вакцинации, если активных нет вовсе) просто не выводится;
 * если нет ничего активного ни там, ни там — отдельный короткий текст.
 */
export function buildActiveStatusMessage(): string {
  const requests = splitByStatus(listActiveRequests());
  const vaccinations = splitByStatus(listActiveVaccinations());

  const lines: string[] = [];

  if (requests.open.length || requests.inWork.length) {
    lines.push('Заявки:');
    if (requests.open.length) lines.push(`Открыты: ${formatEntries(requests.open)}`);
    if (requests.inWork.length) lines.push(`В работе у врачей: ${formatEntries(requests.inWork)}`);
  }

  if (vaccinations.open.length || vaccinations.inWork.length) {
    if (lines.length) lines.push('');
    lines.push('Вакцинации:');
    if (vaccinations.open.length) lines.push(`Открыты: ${formatEntries(vaccinations.open)}`);
    if (vaccinations.inWork.length) lines.push(`В работе у врачей: ${formatEntries(vaccinations.inWork)}`);
  }

  return lines.length ? lines.join('\n') : 'Нет активных заявок';
}
