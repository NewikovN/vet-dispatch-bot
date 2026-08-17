import { createStepDraft, type StepDraft } from './stepDraft.js';

// Отдельный черновик, не переиспользует draft.ts (заявки) — разные поля, смешивать состояние
// заявки и вакцинации в одной структуре только запутало бы. Общая механика — в stepDraft.ts.
// Город — кнопкой первым шагом (как в заявке), дальше текстом.
//
// Набор полей — тот же, что у заявки (date/animal/problem/priceNote/address/clientContacts, см.
// draft.ts), плюс два собственных: vaccineType, nextDate. Порядок: date/animal — идентификация,
// сразу за ними — медицинская пара vaccineType/nextDate (какая вакцина → когда следующая, это
// естественно спросить одно за другим), дальше problem/priceNote/address/clientContacts — как в
// заявке, в том же порядке и по тем же причинам (address без квартиры видят все врачи ДО
// принятия; clientContacts дублирует адрес с квартирой, скрыт до одобрения).
export const FIELDS = [
  'date',
  'animal',
  'vaccineType',
  'nextDate',
  'problem',
  'priceNote',
  'address',
  'clientContacts',
] as const;
export type Field = typeof FIELDS[number];

export const PROMPTS: Record<Field, string> = {
  date: 'Дата вакцинации (например: 16.07.2026)',
  animal: 'Кого вакцинировали (кличка/вид)',
  vaccineType: 'Какая вакцина',
  nextDate: 'Следующая дата вакцинации (например: 16.07.2027; если не нужна — «нет» или «-»)',
  problem: 'Особенности приёма (если нет — напишите «-»)',
  priceNote: 'Что оговорено по ценам',
  // Без квартиры/офиса — это поле видят все врачи ещё ДО принятия записи (нейтральная карточка
  // в рабочем чате), в отличие от clientContacts, который скрыт до одобрения. Формулировка — как
  // в draft.ts (заявка), тот же смысл.
  address: 'Адрес выезда — БЕЗ номера квартиры/офиса (его видят все врачи ещё до принятия записи)',
  // Дублируем адрес, но уже с квартирой/офисом — этот текст виден только врачу, который взял
  // запись, и только после одобрения.
  clientContacts: 'Контакты клиента (имя, телефон) и полный адрес с квартирой/офисом (виден врачу только после одобрения)',
};

export type VaccineDraft = StepDraft<Field>;

const controller = createStepDraft(FIELDS, PROMPTS);

export const startDraft = controller.startDraft;
export const getDraft = controller.getDraft;
export const cancelDraft = controller.cancelDraft;
export const setDraftCity = controller.setDraftCity;
export const applyAnswer = controller.applyAnswer;
export const isComplete = controller.isComplete;
