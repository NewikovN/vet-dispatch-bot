import type { Api } from '@maxhub/max-bot-api';
import type { Messenger, RequestCard } from '../../ports/Messenger.js';
import {
  renderCardText,
  renderManageCardText,
  renderWorkKeyboard,
  renderManageKeyboard,
  renderPrivateKeyboard,
} from './cardView.js';

/** Реализация порта Messenger поверх @maxhub/max-bot-api. Только перевод вызовов в API, без бизнес-логики. */
export class MaxAdapter implements Messenger {
  constructor(private readonly api: Api) {}

  async sendGroupCard(chatId: string, card: RequestCard): Promise<string> {
    const kb = renderWorkKeyboard(card);
    const message = await this.api.sendMessageToChat(Number(chatId), renderCardText(card), {
      attachments: kb ? [kb] : undefined,
    });
    return message.body.mid;
  }

  async editGroupCard(_chatId: string, messageId: string, card: RequestCard): Promise<void> {
    const kb = renderWorkKeyboard(card);
    await this.api.editMessage(messageId, {
      text: renderCardText(card),
      attachments: kb ? [kb] : undefined,
    });
  }

  async sendManageCard(chatId: string, card: RequestCard): Promise<string> {
    const kb = renderManageKeyboard(card);
    const message = await this.api.sendMessageToChat(Number(chatId), renderManageCardText(card), {
      attachments: kb ? [kb] : undefined,
    });
    return message.body.mid;
  }

  async editManageCard(_chatId: string, messageId: string, card: RequestCard): Promise<void> {
    const kb = renderManageKeyboard(card);
    await this.api.editMessage(messageId, {
      text: renderManageCardText(card),
      attachments: kb ? [kb] : undefined,
    });
  }

  /** dmChatId здесь = MAX userId врача: личка шлётся через sendMessageToUser, а не через chat_id */
  async sendPrivate(dmChatId: string, text: string, requestId?: number): Promise<void> {
    const kb = requestId != null ? renderPrivateKeyboard(requestId) : undefined;
    await this.api.sendMessageToUser(Number(dmChatId), text, {
      attachments: kb ? [kb] : undefined,
    });
  }

  /** eventId здесь = callback_id из события message_callback */
  async answerCallback(eventId: string, text: string): Promise<void> {
    await this.api.answerOnCallback(eventId, { notification: text });
  }
}
