import { createStepDraft, type StepDraft } from './stepDraft.js';

// Отдельный черновик, не переиспользует draft.ts (заявки) — разные поля, смешивать состояние
// заявки и вакцинации в одной структуре только запутало бы. Общая механика — в stepDraft.ts.
// Город — кнопкой первым шагом (как в заявке), дальше текстом.
export const FIELDS = ['vaccinationDate', 'vaccineType', 'animal', 'nextDate', 'clientContacts'] as const;
export type Field = typeof FIELDS[number];

export const PROMPTS: Record<Field, string> = {
  vaccinationDate: 'Дата вакцинации (например: 16.07.2026)',
  vaccineType: 'Какая вакцина',
  animal: 'Кого вакцинировали (кличка/вид)',
  nextDate: 'Следующая дата вакцинации (например: 16.07.2027; если не нужна — «нет» или «-»)',
  clientContacts: 'Контакты клиента (имя, телефон)',
};

export type VaccineDraft = StepDraft<Field>;

const controller = createStepDraft(FIELDS, PROMPTS);

export const startDraft = controller.startDraft;
export const getDraft = controller.getDraft;
export const cancelDraft = controller.cancelDraft;
export const setDraftCity = controller.setDraftCity;
export const applyAnswer = controller.applyAnswer;
export const isComplete = controller.isComplete;
