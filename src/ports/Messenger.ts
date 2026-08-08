export interface RequestCard {
  requestId: number;
  date: string;
  city: string;
  animal: string;
  problem: string;
  priceNote: string;
  status: 'open' | 'taken' | 'approved' | 'closed';
  doctorName?: string;
  checkAmount?: number;
}

export interface Messenger {
  /** Отправить карточку заявки в беседу. Возвращает id сообщения. */
  sendGroupCard(chatId: string, card: RequestCard): Promise<string>;

  /** Перерисовать карточку в беседе (убрать кнопку, показать врача). */
  editGroupCard(chatId: string, messageId: string, card: RequestCard): Promise<void>;

  /** Отправить карточку заявки в управленческий чат (с деталями: врач, сумма). Возвращает id сообщения. */
  sendManageCard(chatId: string, card: RequestCard): Promise<string>;

  /** Перерисовать карточку в управленческом чате. */
  editManageCard(chatId: string, messageId: string, card: RequestCard): Promise<void>;

  /** Личное сообщение — сюда уходят контакты клиента. */
  sendPrivate(dmChatId: string, text: string, requestId?: number): Promise<void>;

  /** Ответ на нажатие кнопки: всплывашка «Заявка уже принята». */
  answerCallback(eventId: string, text: string): Promise<void>;
}