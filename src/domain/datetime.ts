/**
 * МСК = UTC+3. Директор мыслит месяцем/датами в московском времени, а created_at и
 * прочие таймстемпы хранятся в UTC (toISOString). Единственное место в проекте, где
 * зашит часовой сдвиг отчётности — если он когда-нибудь изменится, меняем только тут.
 */
export const MSK_OFFSET_HOURS = 3;

export interface DateRange {
  /** ISO UTC, начало периода 00:00:00.000 МСК */
  from: string;
  /** ISO UTC, конец периода 23:59:59.999 МСК */
  to: string;
}

/** Границы одного месяца (month: 1-12) в МСК, в виде ISO UTC — для сравнения с created_at */
export function monthRangeMsk(year: number, month: number): DateRange {
  return {
    from: new Date(Date.UTC(year, month - 1, 1, -MSK_OFFSET_HOURS, 0, 0, 0)).toISOString(),
    to: new Date(Date.UTC(year, month, 0, 23 - MSK_OFFSET_HOURS, 59, 59, 999)).toISOString(),
  };
}

/** Границы диапазона месяцев включительно: начало первого месяца → конец последнего, в МСК */
export function monthRangeSpanMsk(fromYear: number, fromMonth: number, toYear: number, toMonth: number): DateRange {
  return {
    from: monthRangeMsk(fromYear, fromMonth).from,
    to: monthRangeMsk(toYear, toMonth).to,
  };
}

function isValidMonth(month: number): boolean {
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

function monthLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export type PeriodParseResult = { ok: true; range: DateRange; label: string } | { ok: false };

/**
 * Разбирает период, введённый текстом:
 * - "ГГГГ.ММ" или "ГГГГ-ММ" — один месяц;
 * - "ГГГГ.ММ-ГГГГ.ММ" (разделители "." и "-" в любой комбинации) — диапазон месяцев включительно.
 * Границы всегда строятся в МСК через monthRangeMsk/monthRangeSpanMsk.
 */
export function parsePeriod(text: string): PeriodParseResult {
  const trimmed = text.trim();

  const rangeMatch = /^(\d{4})[.-](\d{2})-(\d{4})[.-](\d{2})$/.exec(trimmed);
  if (rangeMatch) {
    const fromYear = Number(rangeMatch[1]);
    const fromMonth = Number(rangeMatch[2]);
    const toYear = Number(rangeMatch[3]);
    const toMonth = Number(rangeMatch[4]);
    if (!isValidMonth(fromMonth) || !isValidMonth(toMonth)) return { ok: false };

    const range = monthRangeSpanMsk(fromYear, fromMonth, toYear, toMonth);
    if (range.from > range.to) return { ok: false }; // конец периода раньше начала

    return { ok: true, range, label: `${monthLabel(fromYear, fromMonth)}_${monthLabel(toYear, toMonth)}` };
  }

  const singleMatch = /^(\d{4})[.-](\d{2})$/.exec(trimmed);
  if (singleMatch) {
    const year = Number(singleMatch[1]);
    const month = Number(singleMatch[2]);
    if (!isValidMonth(month)) return { ok: false };

    return { ok: true, range: monthRangeMsk(year, month), label: monthLabel(year, month) };
  }

  return { ok: false };
}

/** ISO UTC → "ДД.ММ.ГГГГ ЧЧ:ММ" в МСК. Пусто/null/undefined → '' (пустая ячейка отчёта). */
export function formatMsk(iso: string | null | undefined): string {
  if (!iso) return '';

  const parsed = new Date(iso);
  // Не-ISO значение (например, дата вакцинации, которую не удалось разобрать через
  // parseDateToIso, и она осталась как введённый текст) — возвращаем как есть, а не
  // "NaN.NaN.NaN NaN:NaN". Запись не теряется, просто не форматируется.
  if (Number.isNaN(parsed.getTime())) return iso;

  // Дата всегда хранится как момент времени в UTC. Сдвигаем на MSK_OFFSET_HOURS и читаем
  // getUTC*-компоненты у сдвинутого значения — так получаем "настенное" время МСК без
  // зависимости от часового пояса машины, на которой выполняется код.
  const shifted = new Date(parsed.getTime() + MSK_OFFSET_HOURS * 60 * 60 * 1000);

  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const year = shifted.getUTCFullYear();
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');

  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/**
 * "16.07.2026" (день.месяц.год, разделитель "." или "-", день/месяц можно без ведущего нуля)
 * → ISO UTC, полдень МСК этого календарного дня (полдень — чтобы точно остаться в пределах
 * своего дня при любых дальнейших сдвигах пояса). Нужно для вакцинаций: в отличие от заявок
 * (там свободный текст никогда не участвует в фильтрах), дата вакцинации — это и есть поле
 * фильтра отчёта, поэтому её нужно привести к сравнимому виду, иначе диапазон по месяцу
 * не будет работать. НЕ отвергаем нераспознанный ввод (не усложняем валидацию) — просто
 * возвращаем null, вызывающая сторона сама решает, что делать (сохранить как есть текстом).
 */
export function parseDateToIso(text: string): string | null {
  const match = /^(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})$/.exec(text.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return new Date(Date.UTC(year, month - 1, day, 12 - MSK_OFFSET_HOURS, 0, 0, 0)).toISOString();
}
