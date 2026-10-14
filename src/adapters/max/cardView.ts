import { Keyboard } from '@maxhub/max-bot-api';
import type { RequestCard } from '../../ports/Messenger.js';
import { formatMoney } from '../../domain/money.js';
import { formatMsk } from '../../domain/datetime.js';

type InlineKeyboard = ReturnType<typeof Keyboard.inlineKeyboard>;

/**
 * Общая шапка для всех трёх текстовых рендеров ниже: заголовок + дата/город/адрес/животное
 * [+ вакцина/следующая дата, ТОЛЬКО если card.vaccineType задан] + проблема [+ оговорено].
 *
 * card.vaccineType задаётся ТОЛЬКО у карточки вакцинации (vaccinationService.ts) — заявке эти
 * поля не задаются (см. RequestCard в ports/Messenger.ts), поэтому наличие vaccineType и есть
 * признак «это вакцинация», по нему же меняется заголовок (💉 вместо 📋) — иначе карточка
 * вакцинации в чате визуально неотличима от обычной выездной заявки.
 */
function renderHeaderLines(card: RequestCard): string[] {
  const isVaccination = card.vaccineType != null;

  const lines = [
    isVaccination ? `💉 Вакцинация №${card.requestId}` : `📋 Заявка №${card.requestId}`,
    ``,
  ];

  // Кто завёл заявку/вакцинацию — сразу после заголовка, рядом с остальными «шапочными»
  // фактами (дата/город/адрес), а не в конце у статуса: это атрибут самой записи (кто её
  // зарегистрировал), а не текущего состояния — незачем перечитывать всю карточку, чтобы найти.
  if (card.createdByName) lines.push(`Создал: ${card.createdByName}`);

  lines.push(
    `Дата: ${card.date}`,
    `Город: ${card.city}`,
    `Адрес: ${card.address}`,
    `Животное: ${card.animal}`,
  );

  if (isVaccination) {
    lines.push(`Вакцина: ${card.vaccineType}`);
    if (card.nextDate) lines.push(`Следующая вакцинация: ${card.nextDate}`);
  }

  // У вакцинации это поле подписано «Особенности приёма» на шаге черновика (vaccineDraft.ts),
  // не «проблема» — надпись на карточке следует за смыслом.
  lines.push(`${isVaccination ? 'Особенности' : 'Проблема'}: ${card.problem}`);
  if (card.priceNote) lines.push(`Оговорено: ${card.priceNote}`);

  return lines;
}

/** Рабочий чат врачей: карточка ВСЕГДА нейтральная — без имени принявшего и без суммы чека */
export function renderCardText(card: RequestCard): string {
  const lines = renderHeaderLines(card);
  lines.push('');

  switch (card.status) {
    case 'open':
      lines.push('🟢 Свободна');
      break;
    case 'taken':
    case 'approved':
      lines.push('🔵 В работе');
      break;
    case 'closed':
      lines.push('✅ Закрыта');
      break;
    case 'cancelled':
      lines.push('🚫 Отменена');
      break;
  }

  return lines.join('\n');
}

/**
 * Управленческий чат: карточка с деталями — кто принял, сумма чека, и (решение заказчика)
 * контакты клиента ВСЕГДА, на любом статусе — не только после одобрения. Рабочая карточка
 * (renderCardText) контакты по-прежнему не показывает никогда.
 */
export function renderManageCardText(card: RequestCard): string {
  const lines = renderHeaderLines(card);
  lines.push('');

  switch (card.status) {
    case 'open':
      lines.push('🟢 Свободна');
      break;
    case 'taken':
      lines.push(`🔵 Принял: ${card.doctorName ?? '—'}, ожидает одобрения`);
      break;
    case 'approved':
      lines.push(`✅ Одобрено, принял: ${card.doctorName ?? '—'}`);
      break;
    case 'closed':
      lines.push(`✅ Закрыл: ${card.doctorName ?? '—'}`);
      if (card.checkAmount != null) lines.push(`Чек: ${formatMoney(card.checkAmount)}`);
      break;
    case 'cancelled':
      lines.push('🚫 Отменена');
      break;
  }

  // Время принятия/закрытия — ДД.ММ.ГГГГ ЧЧ:ММ в МСК, тот же formatMsk, что в Excel-отчётах.
  // Сразу под строкой статуса: это хронология самой заявки, а не отдельный блок. Показываем
  // только там, где значение есть (taken_at обнуляется при отклонении — см. workflowRepo.ts),
  // поэтому у свободной/отменённой заявки строк просто не будет.
  const takenAt = formatMsk(card.takenAt);
  if (takenAt) lines.push(`Принята: ${takenAt}`);
  const closedAt = formatMsk(card.closedAt);
  if (closedAt) lines.push(`Закрыта: ${closedAt}`);

  if (card.clientContacts) {
    lines.push('');
    lines.push(`Контакты клиента:\n${card.clientContacts}`);
  }

  return lines.join('\n');
}

/**
 * Личка врача после одобрения: ВСЯ карточка заявки целиком (те же поля, что в управленческом
 * чате) + контакты клиента в конце. Раньше сюда уходил только голый текст с контактами —
 * теперь врач сразу видит дату/город/животное/проблему/оговорённую цену, не листая рабочий чат.
 */
export function renderDoctorCardText(card: RequestCard & { clientContacts: string }): string {
  const isVaccination = card.vaccineType != null;
  const lines = renderHeaderLines(card);
  lines.push('');
  lines.push(isVaccination ? '✅ Вакцинация одобрена, вам в работу' : '✅ Заявка одобрена, вам в работу');
  lines.push('');
  lines.push(`Контакты клиента:\n${card.clientContacts}`);

  return lines.join('\n');
}

/** Клавиатура рабочего чата: только «Принять», пока заявка свободна */
export function renderWorkKeyboard(card: RequestCard): InlineKeyboard | undefined {
  if (card.status !== 'open') return undefined;

  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('Принять', `take:${card.requestId}`, { intent: 'positive' })],
  ]);
}

/**
 * Клавиатура управленческого чата: пока заявка ОТКРЫТА (никто не принял) — «Отменить»; пока
 * ждёт решения (кто-то принял) — «Одобрить»/«Отклонить»; ОДОБРЕНА (до закрытия) — «Вернуть в
 * работу» (форс-мажор — врач не может приехать); ОТМЕНЕНА — «Вернуть в работу» (передумали,
 * заявка снова нужна; payload другой — restore вместо return, это переход с другого статуса,
 * см. workflowRepo.ts); закрыта — без кнопок.
 */
export function renderManageKeyboard(card: RequestCard): InlineKeyboard | undefined {
  if (card.status === 'open') {
    return Keyboard.inlineKeyboard([
      [Keyboard.button.callback('Отменить', `cancel:${card.requestId}`, { intent: 'negative' })],
    ]);
  }

  if (card.status === 'taken') {
    return Keyboard.inlineKeyboard([
      [
        Keyboard.button.callback('Одобрить', `approve:${card.requestId}`, { intent: 'positive' }),
        Keyboard.button.callback('Отклонить', `reject:${card.requestId}`, { intent: 'negative' }),
      ],
    ]);
  }

  if (card.status === 'approved') {
    return Keyboard.inlineKeyboard([
      [Keyboard.button.callback('Вернуть в бот', `return:${card.requestId}`, { intent: 'negative' })],
    ]);
  }

  if (card.status === 'cancelled') {
    return Keyboard.inlineKeyboard([
      [Keyboard.button.callback('Вернуть в работу', `restore:${card.requestId}`, { intent: 'positive' })],
    ]);
  }

  return undefined;
}

/** Клавиатура в личке врача: «Закрыть заявку» после одобрения */
export function renderPrivateKeyboard(requestId: number): InlineKeyboard {
  return Keyboard.inlineKeyboard([[Keyboard.button.callback('Закрыть заявку', `close:${requestId}`)]]);
}

/**
 * Клавиатура выбора направления: по кнопке на каждый настроенный город.
 * payloadPrefix различает контекст выбора — "city" (создание заявки), "repcity" (отчёт по
 * направлению) или "repcd" (отчёт: направление + дата).
 */
export function renderCitySelectKeyboard(cities: string[], payloadPrefix: string = 'city'): InlineKeyboard {
  return Keyboard.inlineKeyboard(cities.map((city) => [Keyboard.button.callback(city, `${payloadPrefix}:${city}`)]));
}

/** Меню выбора СУЩНОСТИ отчёта: заявки / вакцинации — первый шаг /отчет */
export function renderReportTypeKeyboard(): InlineKeyboard {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('Заявки', 'rtype:req')],
    [Keyboard.button.callback('Вакцины', 'rtype:vac')],
  ]);
}

/** Меню фильтров отчёта: полный / по направлению / по дате / направление+дата. type — заявки/вакцины, разошлось на предыдущем шаге и вшито в payload каждой кнопки. */
export function renderReportMenuKeyboard(type: 'req' | 'vac'): InlineKeyboard {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('Полный', `rep:${type}:all`)],
    [Keyboard.button.callback('По направлению', `rep:${type}:city`)],
    [Keyboard.button.callback('По дате', `rep:${type}:date`)],
    [Keyboard.button.callback('Направление + дата', `rep:${type}:citydate`)],
  ]);
}
