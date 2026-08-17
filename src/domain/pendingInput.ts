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

/**
 * То же самое, но для вакцинации — ОТДЕЛЬНАЯ карта, не переиспользует waitingForAmount выше.
 * Если бы врач одновременно закрывал заявку №5 и вакцинацию №5, общая карта userId → id не
 * смогла бы различить, какую сущность он закрывает, когда придёт сумма. handlers.ts пока эти
 * функции не вызывает (следующий подшаг) — существующий поток заявок (askAmount/
 * getAwaitedRequest/clearAwait) этой правкой не тронут.
 */
const waitingForVaccinationAmount = new Map<string, number>();

export function askVaccinationAmount(userId: string, vaccinationId: number): void {
  waitingForVaccinationAmount.set(userId, vaccinationId);
}

export function getAwaitedVaccination(userId: string): number | undefined {
  return waitingForVaccinationAmount.get(userId);
}

export function clearVaccinationAwait(userId: string): void {
  waitingForVaccinationAmount.delete(userId);
}

export type EntityKind = 'request' | 'vaccination';

/**
 * Какой сущности принадлежит карточка, отправленная врачу в личку (Messenger.sendDoctorCard) —
 * messageId → 'request' | 'vaccination'. Нужна для handlers.ts: кнопка «Закрыть» живёт в личке
 * врача, а эта карточка, в отличие от рабочей/управленческой, нигде в БД не хранится (у нас нет
 * dm_message_id), поэтому определить сущность по group_message_id/manage_message_id, как для
 * take/approve/reject/cancel, для неё нельзя. requestService.ts/vaccinationService.ts
 * регистрируют запись здесь сразу после sendDoctorCard (approveTake/approveVaccinationTake);
 * handlers.ts читает и сразу же удаляет запись при нажатии «Закрыть» — дальше сущность уже
 * известна по отдельным картам askAmount/askVaccinationAmount выше.
 *
 * In-memory, как и остальные карты в этом файле — если бот перезапустится ровно между
 * одобрением и нажатием «Закрыть», запись потеряется, и handlers.ts падает в резервный путь
 * (поиск по голому id в обеих таблицах — там уже возможна коллизия при одинаковом id в обеих
 * таблицах одновременно, но это исключительно узкий и редкий случай для restart-окна).
 */
const doctorCardEntity = new Map<string, EntityKind>();

export function registerDoctorCardEntity(messageId: string, kind: EntityKind): void {
  doctorCardEntity.set(messageId, kind);
}

export function getDoctorCardEntity(messageId: string): EntityKind | undefined {
  return doctorCardEntity.get(messageId);
}

export function clearDoctorCardEntity(messageId: string): void {
  doctorCardEntity.delete(messageId);
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