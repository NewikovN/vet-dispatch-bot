import { createStepDraft, type StepDraft } from './stepDraft.js';

// Город (направление) выбирается кнопкой ДО текстовых шагов — поэтому в FIELDS его нет,
// он хранится в Draft.city отдельно.
export const FIELDS = ['date', 'animal', 'problem', 'priceNote', 'address', 'clientContacts'] as const;
export type Field = typeof FIELDS[number];

export const PROMPTS: Record<Field, string> = {
  date: 'Дата выезда (например: 16.07.2026)',
  animal: 'Животное (вид, возраст)',
  problem: 'Описание проблемы',
  priceNote: 'Что оговорено по ценам',
  // Без квартиры/офиса — это поле видят все врачи ещё ДО принятия заявки (нейтральная
  // карточка в рабочем чате), в отличие от clientContacts, который скрыт до одобрения.
  address: 'Адрес выезда — БЕЗ номера квартиры/офиса (его видят все врачи ещё до принятия заявки)',
  // Дублируем адрес, но уже с квартирой/офисом — этот текст виден только врачу, который
  // взял заявку, и только после одобрения.
  clientContacts: 'Контакты клиента (имя, телефон) и полный адрес с квартирой/офисом (виден врачу только после одобрения)',
};

export type Draft = StepDraft<Field>;

const controller = createStepDraft(FIELDS, PROMPTS);

export const startDraft = controller.startDraft;
export const getDraft = controller.getDraft;
export const cancelDraft = controller.cancelDraft;
export const setDraftCity = controller.setDraftCity;
export const applyAnswer = controller.applyAnswer;
export const isComplete = controller.isComplete;
