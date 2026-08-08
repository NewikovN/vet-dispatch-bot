import type { VK } from 'vk-io';
import type { Messenger, RequestCard } from '../../ports/Messenger.js';
import { renderCardText, renderCardKeyboard, renderPrivateKeyboard } from './cardView.js';

export class VkAdapter implements Messenger {
  constructor(private readonly vk: VK) {}

  async sendGroupCard(chatId: string, card: RequestCard): Promise<string> {
    const result = await this.vk.api.messages.send({
      peer_ids: [Number(chatId)],
      random_id: 0,
      message: renderCardText(card),
      keyboard: renderCardKeyboard(card),
    }) as unknown as Array<{ conversation_message_id: number }>;

    return String(result[0].conversation_message_id);
  }

  async editGroupCard(chatId: string, messageId: string, card: RequestCard): Promise<void> {
    await this.vk.api.messages.edit({
      peer_id: Number(chatId),
      conversation_message_id: Number(messageId),
      message: renderCardText(card),
      keyboard: renderCardKeyboard(card),
    });
  }

  async sendPrivate(dmChatId: string, text: string, requestId?: number): Promise<void> {
    await this.vk.api.messages.send({
      peer_id: Number(dmChatId),
      random_id: 0,
      message: text,
      keyboard: requestId != null ? renderPrivateKeyboard(requestId) : undefined,
    });
  }

  async answerCallback(eventId: string, text: string): Promise<void> {
    const { userId, peerId, eventId: id } = JSON.parse(eventId);
    await this.vk.api.messages.sendMessageEventAnswer({
      event_id: id,
      user_id: userId,
      peer_id: peerId,
      event_data: JSON.stringify({ type: 'show_snackbar', text }),
    });
  }
}