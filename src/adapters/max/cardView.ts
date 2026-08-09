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
