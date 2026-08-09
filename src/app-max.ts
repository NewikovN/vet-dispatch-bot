/**
 * Точка входа MAX-адаптера: основной поток (онбординг, создание заявки, захват,
 * одобрение/отклонение, закрытие). Команды директора и привязка чатов к городам — следующий шаг.
 */
import './db/index.js';
import { config } from './config.js';
import { bot } from './adapters/max/bot.js';
import { MaxAdapter } from './adapters/max/MaxAdapter.js';

import { publishRequest, takeRequest, approveTake, rejectTake, startClosing, finishClosing } from './domain/requestService.js';
import { canCreateRequest } from './domain/models.js';
import { getAwaitedRequest, parseMoney } from './domain/pendingInput.js';
import { startDraft, getDraft, applyAnswer, cancelDraft } from './domain/draft.js';

import { ensureUser, setDmChatId, getUser } from './db/usersRepo.js';

const messenger = new MaxAdapter(bot.api);

// Первый директор задаётся в .env (как в VK-версии)
if (!getUser(config.directorId)) {
  ensureUser(config.directorId, 'Директор');
}
console.log('Директор:', config.directorId);

/** Онбординг: пользователь впервые открыл диалог с ботом */
bot.on('bot_started', async (ctx) => {
  const userId = String(ctx.user.user_id);
  const displayName = ctx.user.name;

  console.log(`bot_started: userId=${userId}, chatId=${ctx.chatId}, name=${displayName}`);

  ensureUser(userId, displayName);
  // dmChatId здесь = MAX userId (личка шлётся через sendMessageToUser, не через chat_id)
  setDmChatId(userId, userId);

  await messenger.sendPrivate(userId, 'Вы зарегистрированы. Директор назначит вам роль.');
});

/** Кто-то добавил бота в групповой чат — пригодится позже для привязки чата к городу */
bot.on('bot_added', (ctx) => {
  console.log(`bot_added: chatId=${ctx.chatId}`);
});

/** Входящие сообщения. Обрабатываем ТОЛЬКО личку — в группах бот только постит карточки. */
bot.on('message_created', async (ctx) => {
  const message = ctx.message;
  const chatType = message.recipient.chat_type;
  const text = (message.body.text ?? '').trim();
  const senderId = message.sender?.user_id;

  console.log(`message_created: chatType=${chatType}, chatId=${ctx.chatId}, senderId=${senderId}, текст="${text}"`);

  if (chatType !== 'dialog') {
    // Групповой чат — вход бот тут не принимает, реагирует только на кнопки (message_callback)
    return;
  }
  if (senderId == null) return;

  const userId = String(senderId);
  ensureUser(userId, message.sender?.name ?? 'Без имени');
  setDmChatId(userId, userId);

  // Ждём сумму чека?
  const awaited = getAwaitedRequest(userId);
  if (awaited != null) {
    const amount = parseMoney(text);
    if (amount == null) {
      await messenger.sendPrivate(userId, 'Не понял сумму. Введите число, например: 1500');
      return;
    }
    // chatId в finishClosing сейчас не используется (обе карточки находятся через город заявки)
    await finishClosing(messenger, awaited, userId, amount, '');
    return;
  }

  // Отмена заполнения заявки
  if (text === '/отмена') {
    cancelDraft(userId);
    await messenger.sendPrivate(userId, 'Отменено.');
    return;
  }

  // Идёт заполнение заявки?
  const draft = getDraft(userId);
  if (draft) {
    const next = applyAnswer(userId, text);

    if (next) {
      await messenger.sendPrivate(userId, next);
      return;
    }

    const values = getDraft(userId)!.values;
    cancelDraft(userId);

    const result = await publishRequest(messenger, {
      createdBy: userId,
      date: values.date!,
      city: values.city!,
      animal: values.animal!,
      problem: values.problem!,
      priceNote: values.priceNote!,
      clientContacts: values.clientContacts!,
    });

    if (!result.ok) {
      await messenger.sendPrivate(userId, result.error ?? 'Не удалось опубликовать заявку.');
      return;
    }

    await messenger.sendPrivate(userId, 'Заявка опубликована в рабочем чате.');
    return;
  }

  // Начать новую заявку
  if (text === '/заявка') {
    const user = getUser(userId);
    if (!canCreateRequest(user?.role ?? null)) {
      await messenger.sendPrivate(userId, 'Заявки создают диспетчер, управляющий и директор.');
      return;
    }
    const question = startDraft(userId);
    await messenger.sendPrivate(userId, `Новая заявка. ${question}\n\n/отмена — прервать`);
    return;
  }

  // Ничего не подошло
  const me = getUser(userId);
  if (!me?.role) {
    await messenger.sendPrivate(userId, 'Вы зарегистрированы. Директор назначит вам роль.');
    return;
  }
  await messenger.sendPrivate(userId, 'Не понял команду. Доступно: /заявка');
});

/** Нажатия inline-кнопок в карточках: take / approve / reject / close */
bot.on('message_callback', async (ctx) => {
  const callback = ctx.callback;
  const payload = callback.payload ?? '';
  const userId = String(callback.user.user_id);
  const chatId = ctx.chatId != null ? String(ctx.chatId) : '';
  const eventId = callback.callback_id;

  console.log(`message_callback: payload="${payload}", userId=${userId}, chatId=${chatId}, callback_id=${eventId}`);

  const [action, idStr] = payload.split(':');
  const requestId = Number(idStr);

  if (!action || Number.isNaN(requestId)) {
    await messenger.answerCallback(eventId, 'Не понял нажатие.');
    return;
  }

  switch (action) {
    case 'take':
      await takeRequest(messenger, requestId, userId, chatId, eventId);
      break;
    case 'approve':
      await approveTake(messenger, requestId, userId, eventId);
      break;
    case 'reject':
      await rejectTake(messenger, requestId, userId, eventId);
      break;
    case 'close':
      await startClosing(messenger, requestId, userId, eventId);
      break;
    default:
      await messenger.answerCallback(eventId, 'Неизвестное действие.');
  }
});

// bot.start() крутит long polling в бесконечном цикле и резолвится только после stop() —
// поэтому не await'им его здесь, иначе строка ниже никогда бы не напечаталась.
bot
  .start({
    allowedUpdates: ['bot_started', 'message_created', 'message_callback', 'bot_added'],
  })
  .catch((err) => {
    console.error('Ошибка long polling:', err);
    process.exit(1);
  });

console.log('MAX-бот запущен (long polling)');
