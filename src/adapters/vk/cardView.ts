import { Keyboard, type KeyboardBuilder } from 'vk-io';
import type { RequestCard } from '../../ports/Messenger.js';
import { formatMoney } from '../../domain/money.js';

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

  if (card.status === 'open') {
    lines.push('🟢 Свободна');
  } else if (card.status === 'taken') {
    lines.push(`🔵 Принял: ${card.doctorName ?? '—'}`);
  } else {
    lines.push(`✅ Закрыл: ${card.doctorName ?? '—'}`);
    if (card.checkAmount != null) lines.push(`Чек: ${formatMoney(card.checkAmount)}`);
  }

  return lines.join('\n');
}

export function renderCardKeyboard(card: RequestCard): KeyboardBuilder {
  const kb = Keyboard.builder().inline();

  if (card.status === 'open') {
    kb.callbackButton({
      label: 'Принять',
      payload: { cmd: 'take', id: card.requestId },
      color: Keyboard.POSITIVE_COLOR,
    });
  }

  return kb;
}

export function renderPrivateKeyboard(requestId: number): KeyboardBuilder {
  return Keyboard.builder()
    .inline()
    .callbackButton({
      label: 'Закрыть заявку',
      payload: { cmd: 'close', id: requestId },
      color: Keyboard.PRIMARY_COLOR,
    });
}