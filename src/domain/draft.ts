// Город (направление) выбирается кнопкой ДО текстовых шагов — поэтому в FIELDS его нет,
// он хранится в Draft.city отдельно.
export const FIELDS = ['date', 'animal', 'problem', 'priceNote', 'clientContacts'] as const;
export type Field = typeof FIELDS[number];

export const PROMPTS: Record<Field, string> = {
  date: 'Дата выезда (например: 16.07.2026)',
  animal: 'Животное (вид, возраст)',
  problem: 'Описание проблемы',
  priceNote: 'Что оговорено по ценам',
  clientContacts: 'Контакты клиента (имя, телефон)',
};

export interface Draft {
  city: string | null;
  step: number;
  values: Partial<Record<Field, string>>;
}

const drafts = new Map<string, Draft>();

/** Начинает черновик заявки. Город ещё не выбран — первый шаг (кнопка) задаёт вызывающая сторона. */
export function startDraft(userId: string): void {
  drafts.set(userId, { city: null, step: 0, values: {} });
}

export function getDraft(userId: string): Draft | undefined {
  return drafts.get(userId);
}

export function cancelDraft(userId: string): void {
  drafts.delete(userId);
}

/** Записывает выбранный город. Возвращает первый текстовый вопрос, либо undefined, если черновика нет. */
export function setDraftCity(userId: string, city: string): string | undefined {
  const draft = drafts.get(userId);
  if (!draft) return undefined;

  draft.city = city;
  return PROMPTS[FIELDS[0]];
}

/** Записывает ответ на текстовый вопрос. Возвращает следующий вопрос или null, если заявка готова. */
export function applyAnswer(userId: string, text: string): string | null {
  const draft = drafts.get(userId)!;
  draft.values[FIELDS[draft.step]] = text.trim();
  draft.step += 1;

  if (draft.step >= FIELDS.length) return null;
  return PROMPTS[FIELDS[draft.step]];
}

export function isComplete(draft: Draft): boolean {
  return draft.city != null && draft.step >= FIELDS.length;
}
