/** Кого о чём спросили: userId → requestId */
const waitingForAmount = new Map<string, number>();

export function askAmount(userId: string, requestId: number): void {
  waitingForAmount.set(userId, requestId);
}

export function getAwaitedRequest(userId: string): number | undefined {
  return waitingForAmount.get(userId);
}

export function clearAwait(userId: string): void {
  waitingForAmount.delete(userId);
}

/** '1500' → 150000 копеек. Вернёт null, если это не сумма. */
export function parseMoney(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const rubles = parseFloat(cleaned);
  if (rubles <= 0 || rubles > 1_000_000) return null;
  return Math.round(rubles * 100);
}

/** Тип отчёта, выбираемый первым шагом /отчет — заявки или вакцинации. */
export type ReportType = 'req' | 'vac';

/**
 * Кого ждём: период для отчёта (кнопка «По дате» или «Направление + дата» в /отчет).
 * city != null — направление уже выбрано («Направление + дата»), итоговый фильтр будет
 * {city, from, to}. city == null — период без ограничения по направлению («По дате»).
 * type — какой отчёт строить (заявки/вакцинации), выбран на предыдущем шаге и должен
 * дожить до момента, когда придёт текст с периодом.
 */
const waitingForReportPeriod = new Map<string, { city: string | null; type: ReportType }>();

export function askReportPeriod(userId: string, type: ReportType, city: string | null = null): void {
  waitingForReportPeriod.set(userId, { city, type });
}

export function getAwaitedReportPeriod(userId: string): { city: string | null; type: ReportType } | undefined {
  return waitingForReportPeriod.get(userId);
}

export function clearReportPeriodAwait(userId: string): void {
  waitingForReportPeriod.delete(userId);
}