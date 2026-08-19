/**
 * Сводка активных заявок/вакцинаций (/статус, только директор). Текст собирается здесь,
 * а не в handlers.ts, — та же граница, что у остальных доменных сервисов: что считать
 * «активным» и как это сгруппировать — бизнес-правило, не деталь транспорта.
 */
import { listActiveRequests } from '../db/requestsRepo.js';
import { listActiveVaccinations } from '../db/vaccinationsRepo.js';

function splitByStatus(items: { id: number; status: string }[]): { open: number[]; inWork: number[] } {
  const open: number[] = [];
  const inWork: number[] = [];
  for (const item of items) {
    if (item.status === 'open') open.push(item.id);
    else if (item.status === 'taken' || item.status === 'approved') inWork.push(item.id);
  }
  return { open, inWork };
}

function formatIds(ids: number[]): string {
  return ids.map((id) => `№${id}`).join(', ');
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
    if (requests.open.length) lines.push(`Открыты: ${formatIds(requests.open)}`);
    if (requests.inWork.length) lines.push(`В работе у врачей: ${formatIds(requests.inWork)}`);
  }

  if (vaccinations.open.length || vaccinations.inWork.length) {
    if (lines.length) lines.push('');
    lines.push('Вакцинации:');
    if (vaccinations.open.length) lines.push(`Открыты: ${formatIds(vaccinations.open)}`);
    if (vaccinations.inWork.length) lines.push(`В работе у врачей: ${formatIds(vaccinations.inWork)}`);
  }

  return lines.length ? lines.join('\n') : 'Нет активных заявок';
}
