export interface RequestCard {
  requestId: number;
  date: string;
  city: string;
  /** БЕЗ номера квартиры/офиса — виден врачам всегда, включая нейтральную карточку до принятия. */
  address: string;
  animal: string;
  problem: string;
  priceNote: string;
  status: 'open' | 'taken' | 'approved' | 'closed' | 'cancelled';
  doctorName?: string;
  checkAmount?: number;
  /** Только у карточки вакцинации (vaccinationService.ts) — заявке не задаются. */
  vaccineType?: string;
  nextDate?: string | null;
  /**
   * Только у управленческой карточки (toManageCard в requestService.ts/vaccinationService.ts) —
   * видны там ВСЕГДА, на любом статусе (решение заказчика). Рабочая карточка (toGroupCard) это
   * поле не задаёт — контакты по-прежнему раскрываются врачу личным сообщением (sendDoctorCard)
   * только после одобрения.
   */
  clientContacts?: string;
}

export interface Messenger {
  /** Отправить карточку заявки в беседу. Возвращает id сообщения. */
  sendGroupCard(chatId: string, card: RequestCard): Promise<string>;

  /** Перерисовать карточку в беседе (убрать кнопку, показать врача). */
  editGroupCard(chatId: string, messageId: string, card: RequestCard): Promise<void>;

  /**
   * Форс-мажор «вернуть в работу»: старую карточку в рабочем чате нельзя молча вернуть в статус
   * open через editGroupCard — если чат уже наспамили другими сообщениями, актуальную кнопку
   * «Принять» никто не заметит. Вместо этого старое сообщение помечается простым текстом БЕЗ
   * клавиатуры (чтобы не было двух активных карточек одной заявки с кнопкой «Принять»
   * одновременно), а новая карточка с кнопкой отправляется заново через sendGroupCard.
   */
  markGroupCardMoved(chatId: string, messageId: string, text: string): Promise<void>;

  /** Отправить карточку заявки в управленческий чат (с деталями: врач, сумма). Возвращает id сообщения. */
  sendManageCard(chatId: string, card: RequestCard): Promise<string>;

  /** Перерисовать карточку в управленческом чате. */
  editManageCard(chatId: string, messageId: string, card: RequestCard): Promise<void>;

  /** Личное сообщение — сюда уходят контакты клиента. */
  sendPrivate(dmChatId: string, text: string, requestId?: number): Promise<void>;

  /**
   * Врачу после одобрения — вся карточка заявки целиком (все поля + контакты), а не только
   * голый текст с контактами. requestId нужен, чтобы прикрепить кнопку «Закрыть заявку».
   * Возвращает id отправленного сообщения — эта карточка нигде в БД не хранится (в отличие от
   * group_message_id/manage_message_id), а handlers.ts нужно уметь отличить нажатие «Закрыть»
   * по заявке от «Закрыть» по вакцинации (см. domain/pendingInput.ts: registerDoctorCardEntity).
   */
  sendDoctorCard(dmChatId: string, card: RequestCard & { clientContacts: string }, requestId: number): Promise<string>;

  /** Отправить файл (например, Excel-отчёт) в личку. */
  sendDocument(dmChatId: string, filename: string, content: Buffer, caption?: string): Promise<void>;

  /** Ответ на нажатие кнопки: всплывашка «Заявка уже принята». */
  answerCallback(eventId: string, text: string): Promise<void>;
}