import { Keyboard } from '@maxhub/max-bot-api';
import type { RequestCard } from '../../ports/Messenger.js';
import { formatMoney } from '../../domain/money.js';

type InlineKeyboard = ReturnType<typeof Keyboard.inlineKeyboard>;

/** Рабочий чат врачей: карточка ВСЕГДА нейтральная — без имени принявшего и без суммы чека */
export function renderCardText(card: RequestCard): string {
  const lines = [
    `📋 Заявка №${card.requestId}`,
    ``,
    `Дата: ${card.date}`,
    `Город: ${card.city}`,
    `Животное: ${card.animal}`,
    `Проблема: ${card.problem}`,
  ];

  if (card.priceNote) lines.push(`Оговорено: ${card.priceNote}`);
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
  }

  return lines.join('\n');
}

/** Управленческий чат: карточка с деталями — кто принял, сумма чека */
export function renderManageCardText(card: RequestCard): string {
  const lines = [
    `📋 Заявка №${card.requestId}`,
    ``,
    `Дата: ${card.date}`,
    `Город: ${card.city}`,
    `Животное: ${card.animal}`,
    `Проблема: ${card.problem}`,
  ];

  if (card.priceNote) lines.push(`Оговорено: ${card.priceNote}`);
  lines.push('');

  switch (card.status) {
    case 'open':
      lines.push('🟢 Свободна');
      break;
    case 'taken':
      lines.push(`🔵 Принял: ${card.doctorName ?? '—'}, ожидает одобрения`);
      break;
    case 'approved':
      lines.push(`✅ Одобрено, врач: ${card.doctorName ?? '—'}`);
      break;
    case 'closed':
      lines.push(`✅ Закрыл: ${card.doctorName ?? '—'}`);
      if (card.checkAmount != null) lines.push(`Чек: ${formatMoney(card.checkAmount)}`);
      break;
  }

  return lines.join('\n');
}

/** Клавиатура рабочего чата: только «Принять», пока заявка свободна */
export function renderWorkKeyboard(card: RequestCard): InlineKeyboard | undefined {
  if (card.status !== 'open') return undefined;

  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('Принять', `take:${card.requestId}`, { intent: 'positive' })],
  ]);
}

/** Клавиатура управленческого чата: «Одобрить»/«Отклонить», пока заявка ждёт решения */
export function renderManageKeyboard(card: RequestCard): InlineKeyboard | undefined {
  if (card.status !== 'taken') return undefined;

  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback('Одобрить', `approve:${card.requestId}`, { intent: 'positive' }),
      Keyboard.button.callback('Отклонить', `reject:${card.requestId}`, { intent: 'negative' }),
    ],
  ]);
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
