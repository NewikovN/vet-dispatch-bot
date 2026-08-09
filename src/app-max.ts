/**
 * Точка входа MAX-адаптера: основной поток (онбординг, создание заявки, захват,
 * одобрение/отклонение, закрытие) + команды директора (роли, привязка чатов к городам).
 */
import './db/index.js';
import { config } from './config.js';
import { bot } from './adapters/max/bot.js';
import { MaxAdapter } from './adapters/max/MaxAdapter.js';
import { renderCitySelectKeyboard } from './adapters/max/cardView.js';

import { publishRequest, takeRequest, approveTake, rejectTake, startClosing, finishClosing } from './domain/requestService.js';
import { canCreateRequest, canManageRoles, type Role } from './domain/models.js';
import { getAwaitedRequest, parseMoney } from './domain/pendingInput.js';
import { startDraft, getDraft, setDraftCity, applyAnswer, cancelDraft } from './domain/draft.js';

import { ensureUser, setDmChatId, setRole, getUser, listActiveUsers, removeUser } from './db/usersRepo.js';
import { listCityChats, setWorkChat, setManageChat } from './db/cityChatsRepo.js';

const messenger = new MaxAdapter(bot.api);

// Первый директор задаётся в .env (как в VK-версии) — не перезатираем имя, если юзер уже есть
if (!getUser(config.directorId)) {
  ensureUser(config.directorId, 'Директор');
}
setRole(config.directorId, 'director');
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

/** Команда /привязать в групповом чате: только директор, только формат "<Город> работа|управление" */
async function handleGroupCommand(userId: string, chatId: string, text: string): Promise<void> {
  const user = getUser(userId);
  if (!canManageRoles(user?.role ?? null)) return; // не директор — молчим, не шумим в общем чате

  const parts = text.trim().split(/\s+/);
  const target = parts[parts.length - 1];
  const city = parts.slice(1, -1).join(' ');

  if (parts[0] !== '/привязать' || parts.length < 3 || (target !== 'работа' && target !== 'управление')) {
    await bot.api.sendMessageToChat(Number(chatId), 'Формат: /привязать <Город> работа|управление');
    return;
  }

  if (target === 'работа') {
    setWorkChat(city, chatId);
    await bot.api.sendMessageToChat(Number(chatId), `Готово: этот чат — рабочий чат города «${city}».`);
  } else {
    setManageChat(city, chatId);
    await bot.api.sendMessageToChat(Number(chatId), `Готово: этот чат — управленческий чат города «${city}».`);
  }
}

/** Входящие сообщения. В личке — полный сценарий, в группе — только команды привязки чата. */
bot.on('message_created', async (ctx) => {
  const message = ctx.message;
  const chatType = message.recipient.chat_type;
  const text = (message.body.text ?? '').trim();
  const senderId = message.sender?.user_id;

  console.log(`message_created: chatType=${chatType}, chatId=${ctx.chatId}, senderId=${senderId}, текст="${text}"`);

  if (chatType !== 'dialog') {
    // Групповой чат: обычные сообщения игнорируем, реагируем только на команды привязки
    if (text.startsWith('/') && senderId != null) {
      await handleGroupCommand(String(senderId), String(ctx.chatId), text);
    }
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

  // --- Команды директора (личка) ---
  if (text.startsWith('/')) {
    const me = getUser(userId);
    const isDirector = canManageRoles(me?.role ?? null);
    const [cmd, arg1, arg2] = text.split(/\s+/);

    if (cmd === '/помощь' || cmd === '/start' || cmd === '/начать') {
      const lines: string[] = ['Бот заявок.', ''];

      if (!me?.role) {
        lines.push('У вас пока нет роли. Обратитесь к директору.');
        lines.push(`(ваш ID: ${userId})`);
      }

      if (canCreateRequest(me?.role ?? null)) {
        lines.push('/заявка — создать заявку');
        lines.push('/отмена — прервать заполнение');
      }

      if (me?.role === 'doctor') {
        lines.push('Заявки приходят в рабочий чат. Нажмите «Принять» — после одобрения контакты придут сюда.');
        lines.push('Кнопка «Закрыть заявку» — под контактами.');
      }

      if (isDirector) {
        lines.push('');
        lines.push('Директор:');
        lines.push('/люди — список сотрудников');
        lines.push('/роль <id> <диспетчер|врач|управляющий|директор>');
        lines.push('/уволить <id>');
        lines.push('/города — привязанные чаты по городам');
        lines.push('/привязать <Город> работа|управление — команда в самом групповом чате');
      }

      await messenger.sendPrivate(userId, lines.join('\n'));
      return;
    }

    if (cmd === '/люди' && isDirector) {
      const users = listActiveUsers();
      const lines = users.map(
        (u) => `${u.userId} — ${u.displayName} — ${u.role ?? 'без роли'}${u.dmChatId ? '' : ' ⚠️ нет лички'}`,
      );
      await messenger.sendPrivate(userId, lines.length ? lines.join('\n') : 'Пока никого нет.');
      return;
    }

    if (cmd === '/роль' && isDirector) {
      const roles: Record<string, Role> = {
        диспетчер: 'dispatcher',
        врач: 'doctor',
        управляющий: 'manager',
        директор: 'director',
      };
      const role = roles[arg2 ?? ''];
      if (arg1 === config.directorId && role !== 'director') {
        await messenger.sendPrivate(userId, 'Главного директора разжаловать нельзя.');
        return;
      }
      if (!arg1 || !role) {
        await messenger.sendPrivate(userId, 'Формат: /роль <id> <диспетчер|врач|управляющий|директор>');
        return;
      }
      if (!getUser(arg1)) {
        await messenger.sendPrivate(userId, 'Такого пользователя нет. Он должен сначала написать боту.');
        return;
      }
      setRole(arg1, role);
      await messenger.sendPrivate(userId, `Готово: ${arg1} → ${arg2}`);
      return;
    }

    if (cmd === '/уволить' && isDirector) {
      if (!arg1 || !getUser(arg1)) {
        await messenger.sendPrivate(userId, 'Формат: /уволить <id>');
        return;
      }
      removeUser(arg1);
      await messenger.sendPrivate(userId, `${arg1} удалён.`);
      return;
    }

    if (cmd === '/города' && isDirector) {
      const cities = listCityChats();
      if (!cities.length) {
        await messenger.sendPrivate(
          userId,
          'Пока ни один город не привязан. В нужном групповом чате: /привязать <Город> работа|управление',
        );
        return;
      }
      const lines = cities.map(
        (c) => `${c.city}: работа=${c.workChatId ?? '⚠️ не задан'}, управление=${c.manageChatId ?? '⚠️ не задан'}`,
      );
      await messenger.sendPrivate(userId, lines.join('\n'));
      return;
    }
  }

  // Идёт заполнение заявки?
  const draft = getDraft(userId);
  if (draft) {
    if (draft.city == null) {
      // Черновик создан, но направление ещё не выбрано кнопкой — текст пока не принимаем
      await messenger.sendPrivate(userId, 'Сначала выберите направление кнопкой выше.');
      return;
    }

    const next = applyAnswer(userId, text);

    if (next) {
      await messenger.sendPrivate(userId, next);
      return;
    }

    const finished = getDraft(userId)!;
    const city = finished.city!; // непусто: выше вернулись бы раньше, если бы город не был выбран
    const values = finished.values;
    cancelDraft(userId);

    const result = await publishRequest(messenger, {
      createdBy: userId,
      date: values.date!,
      city,
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

  // Начать новую заявку: первый шаг — выбор направления кнопкой (список берём из city_chats)
  if (text === '/заявка') {
    const user = getUser(userId);
    if (!canCreateRequest(user?.role ?? null)) {
      await messenger.sendPrivate(userId, 'Заявки создают диспетчер, управляющий и директор.');
      return;
    }

    const cities = listCityChats()
      .filter((c) => c.workChatId && c.manageChatId)
      .map((c) => c.city);

    if (cities.length === 0) {
      await messenger.sendPrivate(userId, 'Нет настроенных направлений, обратитесь к директору.');
      return;
    }

    startDraft(userId);
    await bot.api.sendMessageToUser(Number(userId), 'Новая заявка. Выберите направление:\n\n/отмена — прервать', {
      attachments: [renderCitySelectKeyboard(cities)],
    });
    return;
  }

  // Ничего не подошло
  const me = getUser(userId);
  if (!me?.role) {
    await messenger.sendPrivate(userId, 'Вы зарегистрированы. Директор назначит вам роль.');
    return;
  }
  await messenger.sendPrivate(userId, 'Не понял команду. Наберите /помощь.');
});

/** Нажатия inline-кнопок в карточках: take / approve / reject / close */
bot.on('message_callback', async (ctx) => {
  const callback = ctx.callback;
  const payload = callback.payload ?? '';
  const userId = String(callback.user.user_id);
  const chatId = ctx.chatId != null ? String(ctx.chatId) : '';
  const eventId = callback.callback_id;

  console.log(`message_callback: payload="${payload}", userId=${userId}, chatId=${chatId}, callback_id=${eventId}`);

  // Делим payload только по ПЕРВОМУ двоеточию — название направления может содержать пробелы
  // ("Москва и область"), но не должно ломать разбор, даже если гипотетически содержит ":".
  const sep = payload.indexOf(':');
  const action = sep === -1 ? payload : payload.slice(0, sep);
  const value = sep === -1 ? '' : payload.slice(sep + 1);

  if (action === 'city') {
    const next = setDraftCity(userId, value);
    if (next == null) {
      await messenger.answerCallback(eventId, 'Черновик заявки не найден. Начните заново: /заявка');
      return;
    }
    await messenger.answerCallback(eventId, `Направление: ${value}`);
    await messenger.sendPrivate(userId, next);
    return;
  }

  const requestId = Number(value);

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
