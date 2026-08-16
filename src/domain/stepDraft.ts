/**
 * Общий движок пошагового черновика: выбор города кнопкой первым шагом, дальше текстовые
 * поля по списку. Используется и заявкой (draft.ts), и учётом вакцинаций (vaccineDraft.ts) —
 * два родных набора полей, поэтому не один общий Map с "видом черновика", а два тонких
 * инстанса этой фабрики (см. draft.ts/vaccineDraft.ts) — сама механика (Map, шаг, город) не
 * дублируется.
 */
export interface StepDraft<F extends string> {
  city: string | null;
  step: number;
  values: Partial<Record<F, string>>;
}

export interface StepDraftController<F extends string> {
  /** Начинает черновик. Город ещё не выбран — первый шаг (кнопка) задаёт вызывающая сторона. */
  startDraft(userId: string): void;
  getDraft(userId: string): StepDraft<F> | undefined;
  cancelDraft(userId: string): void;
  /** Записывает выбранный город. Возвращает первый текстовый вопрос, либо undefined, если черновика нет. */
  setDraftCity(userId: string, city: string): string | undefined;
  /** Записывает ответ на текстовый вопрос. Возвращает следующий вопрос или null, если черновик готов. */
  applyAnswer(userId: string, text: string): string | null;
  isComplete(draft: StepDraft<F>): boolean;
}

export function createStepDraft<F extends string>(
  fields: readonly F[],
  prompts: Record<F, string>,
): StepDraftController<F> {
  const drafts = new Map<string, StepDraft<F>>();

  return {
    startDraft(userId) {
      drafts.set(userId, { city: null, step: 0, values: {} });
    },

    getDraft(userId) {
      return drafts.get(userId);
    },

    cancelDraft(userId) {
      drafts.delete(userId);
    },

    setDraftCity(userId, city) {
      const draft = drafts.get(userId);
      if (!draft) return undefined;

      draft.city = city;
      return prompts[fields[0]];
    },

    applyAnswer(userId, text) {
      const draft = drafts.get(userId)!;
      draft.values[fields[draft.step]] = text.trim();
      draft.step += 1;

      if (draft.step >= fields.length) return null;
      return prompts[fields[draft.step]];
    },

    isComplete(draft) {
      return draft.city != null && draft.step >= fields.length;
    },
  };
}
