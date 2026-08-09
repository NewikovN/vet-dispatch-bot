import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      // [] вместо undefined: undefined выпадает из JSON.stringify, поле "attachments" пропадает
      // из тела запроса целиком — MAX трактует его отсутствие как "не менять вложения".
      attachments: kb ? [kb] : [],
    });
    return message.body.mid;
  }

  async editGroupCard(_chatId: string, messageId: string, card: RequestCard): Promise<void> {
    const kb = renderWorkKeyboard(card);
    await this.api.editMessage(messageId, {
      text: renderCardText(card),
      // См. комментарий в sendGroupCard — здесь это критично: без явного [] старая
      // клавиатура «Принять» остаётся висеть на карточке после смены статуса.
      attachments: kb ? [kb] : [],
    });
  }

  async sendManageCard(chatId: string, card: RequestCard): Promise<string> {
    const kb = renderManageKeyboard(card);
    const message = await this.api.sendMessageToChat(Number(chatId), renderManageCardText(card), {
      attachments: kb ? [kb] : [],
    });
    return message.body.mid;
  }

  async editManageCard(_chatId: string, messageId: string, card: RequestCard): Promise<void> {
    const kb = renderManageKeyboard(card);
    await this.api.editMessage(messageId, {
      text: renderManageCardText(card),
      attachments: kb ? [kb] : [],
    });
  }

  /** dmChatId здесь = MAX userId врача: личка шлётся через sendMessageToUser, а не через chat_id */
  async sendPrivate(dmChatId: string, text: string, requestId?: number): Promise<void> {
    const kb = requestId != null ? renderPrivateKeyboard(requestId) : undefined;
    await this.api.sendMessageToUser(Number(dmChatId), text, {
      attachments: kb ? [kb] : undefined,
    });
  }

  /**
   * Файл в личку (например, .xlsx-отчёт).
   *
   * НЕ используем Api.uploadFile()/Upload.file() — баг библиотеки @maxhub/max-bot-api@0.2.5:
   * для type:'file' она может попасть в ту же ветку, что video/audio (core/helpers/upload.js,
   * uploadFromStream) — если getUploadUrl вернул token сразу, грузит байты чанками
   * (Content-Range, uploadRange) и потом просто эхом возвращает ИСХОДНЫЙ token, никак не
   * проверяя готовность вложения. MAX эту заливку обрабатывает как video-пайплайн и на
   * отправке сообщения падает: 400 "Missing `token` in video attachment".
   * Простого обхода в рамках публичного API нет: единственный путь библиотеки с гарантированным
   * мультипартом (Upload.uploadFromBuffer, срабатывает при source instanceof Buffer) есть, но
   * там имя файла всегда randomUUID() без расширения — а нам нужно осмысленное имя
   * (requests_2026-08.xlsx). Поэтому грузим сами через публичный bot.api.raw, минуя
   * Api.uploadFile целиком: getUploadUrl → сами мультипартом на полученный url → сами
   * собираем attachment из token в ответе заливки (а не из ответа getUploadUrl).
   */
  async sendDocument(dmChatId: string, filename: string, content: Buffer, caption?: string): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'vet-dispatch-'));
    const filePath = join(dir, filename);
    try {
      await writeFile(filePath, content);
      const fileBytes = await readFile(filePath);

      // token из этого ответа сознательно игнорируем — см. комментарий выше
      const { url } = await this.api.raw.uploads.getUploadUrl({ type: 'file' });

      const formData = new FormData();
      formData.append('data', new Blob([fileBytes]), filename);
      const uploadRes = await fetch(url, { method: 'POST', body: formData });
      if (!uploadRes.ok) {
        throw new Error(`Загрузка файла в MAX не удалась: ${uploadRes.status} ${await uploadRes.text()}`);
      }
      const { token } = (await uploadRes.json()) as { token: string };

      await this.api.sendMessageToUser(Number(dmChatId), caption ?? '', {
        attachments: [{ type: 'file', payload: { token } }],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** eventId здесь = callback_id из события message_callback */
  async answerCallback(eventId: string, text: string): Promise<void> {
    await this.api.answerOnCallback(eventId, { notification: text });
  }
}
