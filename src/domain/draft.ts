export const FIELDS = ['date', 'city', 'animal', 'problem', 'priceNote', 'clientContacts'] as const;
export type Field = typeof FIELDS[number];

export const PROMPTS: Record<Field, string> = {
  date: 'Дата выезда (например: 16.07.2026)',
  city: 'Город',
  animal: 'Животное (вид, возраст)',
  problem: 'Описание проблемы',
  priceNote: 'Что оговорено по ценам',
  clientContacts: 'Контакты клиента (имя, телефон)',
};

export interface Draft {
  step: number;
  values: Partial<Record<Field, string>>;
}

const drafts = new Map<string, Draft>();

export function startDraft(userId: string): string {
  drafts.set(userId, { step: 0, values: {} });
  return PROMPTS[FIELDS[0]];
}

export function getDraft(userId: string): Draft | undefined {
  return drafts.get(userId);
}

export function cancelDraft(userId: string): void {
  drafts.delete(userId);
}

/** Записывает ответ. Возвращает следующий вопрос или null, если заявка готова. */
export function applyAnswer(userId: string, text: string): string | null {
  const draft = drafts.get(userId)!;
  draft.values[FIELDS[draft.step]] = text.trim();
  draft.step += 1;

  if (draft.step >= FIELDS.length) return null;
  return PROMPTS[FIELDS[draft.step]];
}

export function isComplete(draft: Draft): boolean {
  return draft.step >= FIELDS.length;
}