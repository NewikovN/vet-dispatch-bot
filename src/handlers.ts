/**
 * Регистрация обработчиков событий бота (bot_started, bot_added, message_created,
 * message_callback) — вся бизнес-логика MAX-адаптера в одном месте, ОБЩЕМ для обоих
 * транспортов. Подключается побочным эффектом импорта:
 *   import './handlers.js';
 * — и в app-max.ts (dev, long polling), и в app-max-webhook.ts (прод, webhook). Сам транспорт
 * (bot.start() или Express-сервер) в этом файле не запускается — только bot.on(...).
 */
import './db/index.js';
import { config } from './config.js';
import { bot } from './adapters/max/bot.js';
import { MaxAdapter } from './adapters/max/MaxAdapter.js';
import {
  renderCitySelectKeyboard,
  renderReportTypeKeyboard,
  renderReportMenuKeyboard,
} from './adapters/max/cardView.js';

import { publishRequest, takeRequest, approveTake, rejectTake, cancelOpenRequest, startClosing, finishClosing } from './domain/requestService.js';
import {
  publishVaccination,
  takeVaccination,
  approveVaccinationTake,
  rejectVaccinationTake,
  cancelOpenVaccination,
  startClosingVaccination,
  finishClosingVaccination,
} from './domain/vaccinationService.js';
import { canCreateRequest, canManageRoles, canManageVaccinations, type Role } from './domain/models.js';
import {
  getAwaitedRequest,
  getAwaitedVaccination,
  getDoctorCardEntity,
  clearDoctorCardEntity,
  parseMoney,
  askReportPeriod,
  getAwaitedReportPeriod,
  clearReportPeriodAwait,
  type ReportType,
  type EntityKind,
} from './domain/pendingInput.js';
import { startDraft, getDraft, setDraftCity, applyAnswer, cancelDraft } from './domain/draft.js';
import {
  startDraft as startVaccineDraft,
  getDraft as getVaccineDraft,
  setDraftCity as setVaccineDraftCity,
  applyAnswer as applyVaccineAnswer,
  cancelDraft as cancelVaccineDraft,
} from './domain/vaccineDraft.js';
import { generateRequestsXlsx, generateVaccinationsXlsx } from './domain/exportService.js';
import { parsePeriod, parseDateToIso } from './domain/datetime.js';

import { ensureUser, setDmChatId, setRole, getUser, listActiveUsers, removeUser } from './db/usersRepo.js';
import { listCityChats, setWorkChat, setManageChat } from './db/cityChatsRepo.js';
import { getRequest, findRequestByMessageId } from './db/requestsRepo.js';
import { getVaccination, findVaccinationByMessageId } from './db/vaccinationsRepo.js';

const messenger = new MaxAdapter(bot.api);

/** Фильтр отчёта — форма общая и для заявок, и для вакцинаций (ExportFilter/VaccinationExportFilter структурно идентичны). */
type ReportFilter = { city?: string; from?: string; to?: string };

/** Делит строку по ПЕРВОМУ вхождению разделителя (не по всем) — тот же приём, что и для payload кнопок ниже. */
function splitFirst(text: string, sep: string): [string, string] {
  const i = text.indexOf(sep);
  return i === -1 ? [text, ''] : [text.slice(0, i), text.slice(i + 1)];
}

/**
 * Отличить нажатие кнопки заявки от кнопки вакцинации на take/approve/reject/cancel/close —
 * cardView.ts общий для обеих сущностей (RequestCard), payload кнопки выглядит одинаково
 * ("take:5") независимо от того, заявка это или вакцинация, а requests.id и vaccinations.id —
 * НЕЗАВИСИМЫЕ последовательности (голое число может совпасть у обеих). Три пути, по убыванию
 * точности:
 *
 * 1. Карта pendingInput.getDoctorCardEntity(messageId) — для кнопки «Закрыть» в личке врача.
 *    Эта карточка (Messenger.sendDoctorCard) нигде в БД не хранится (в отличие от
 *    group_message_id/manage_message_id), поэтому approveTake/approveVaccinationTake сами
 *    регистрируют её messageId → сущность сразу при отправке (см. registerDoctorCardEntity).
 *    Запись одноразовая — читаем и сразу удаляем.
 * 2. group_message_id/manage_message_id в БД — для take/approve/reject/cancel (кнопки живут на
 *    рабочей/управленческой карточке, оба id туда пишутся при публикации/принятии). messageId
 *    уникален глобально в MAX, так что точное совпадение однозначно решает, какая это сущность.
 * 3. Прямой поиск по id в каждой таблице (пробуем заявку первой) — самый крайний резерв, если
 *    первые два пути ничего не дали (например, бот перезапускался между одобрением и «Закрыть» —
 *    карта из пункта 1 in-memory и не переживает рестарт). Здесь коллизия id при совпадении в
 *    обеих таблицах ОДНОВременно технически возможна — узкий край случая, не встречавшийся на
 *    практике (вакцинация только начинает вестись, id разошлись с заявками).
 */
function resolveEntityKind(id: number, messageId: string | undefined): EntityKind | null {
  if (messageId) {
    const fromDoctorCard = getDoctorCardEntity(messageId);
    if (fromDoctorCard) {
      clearDoctorCardEntity(messageId);
      return fromDoctorCard;
    }
    if (findRequestByMessageId(messageId)) return 'request';
    if (findVaccinationByMessageId(messageId)) return 'vaccination';
  }
  if (getRequest(id)) return 'request';
  if (getVaccination(id)) return 'vaccination';
  return null;
}

/**
 * Bot.catch(...) — публичный метод (dist/bot.d.ts: `catch(handler): this`), переопределяет
 * внутренний handleError, используемый Bot.handleUpdate. handleUpdate ОБЩИЙ для обоих
 * транспортов (long polling дёргает его из Polling.loop, webhook — из server.ts тем же
 * обходом), поэтому один bot.catch(...) здесь действует и на app-max.ts, и на app-max-webhook.ts.
 *
 * Без этого — дефолтный handleError библиотеки (dist/bot.js) на любой ошибке в обработчике
 * делает process.exitCode = 1 и пробрасывает её дальше. Под systemd это выглядит как «упал
 * процесс» из-за единичного сбоя (например, sendMessageToUser упал, потому что пользователь
 * удалил диалог с ботом) — и ведёт к ненужным перезапускам. Логируем с контекстом события
 * и НЕ пробрасываем: одна неудачная отправка не должна ронять бота для всех остальных.
 */
bot.catch((err, ctx) => {
  console.error('Ошибка обработки события MAX:', {
    updateType: ctx.updateType,
    chatId: ctx.chatId,
    userId: ctx.user?.user_id,
    messageId: ctx.messageId,
    update: ctx.update,
    err,
  });
});

const PERIOD_USAGE_HINT =
  'Формат периода: ГГГГ.ММ (например 2026.08) — один месяц; ГГГГ.ММ-ГГГГ.ММ (например 2026.05-2026.08) — несколько месяцев включительно. Разделитель "." и "-" равнозначны.';

/** Формирует .xlsx (заявки либо вакцинации — см. type) и шлёт директору в личку. label — и в подписи, и в имени файла. */
async function sendReport(userId: string, type: ReportType, filter: ReportFilter, label: string): Promise<void> {
  await messenger.sendPrivate(userId, 'Формирую отчёт…');
  const buffer = type === 'vac' ? await generateVaccinationsXlsx(filter) : await generateRequestsXlsx(filter);
  const prefix = type === 'vac' ? 'vaccinations' : 'requests';
  const caption = type === 'vac' ? 'Отчёт по вакцинам' : 'Отчёт по заявкам';
  const filename = `${prefix}_${label.replace(/\s+/g, '_')}.xlsx`;
  await messenger.sendDocument(userId, filename, buffer, `${caption}: ${label}`);
}

/** Города, где заданы ОБА чата — только они годятся для выбора (создание заявки, отчёт) */
function fullyConfiguredCities(): string[] {
  return listCityChats()
    .filter((c) => c.workChatId && c.manageChatId)
    .map((c) => c.city);
}

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

  // Ждём сумму чека (заявка)?
  const awaitedRequest = getAwaitedRequest(userId);
  if (awaitedRequest != null) {
    const amount = parseMoney(text);
    if (amount == null) {
      await messenger.sendPrivate(userId, 'Не понял сумму. Введите число, например: 1500');
      return;
    }
    // chatId в finishClosing сейчас не используется (обе карточки находятся через город заявки)
    await finishClosing(messenger, awaitedRequest, userId, amount, '');
    return;
  }

  // Ждём сумму чека (вакцинация)? Отдельная карта ожидания — см. pendingInput.ts.
  const awaitedVaccination = getAwaitedVaccination(userId);
  if (awaitedVaccination != null) {
    const amount = parseMoney(text);
    if (amount == null) {
      await messenger.sendPrivate(userId, 'Не понял сумму. Введите число, например: 1500');
      return;
    }
    await finishClosingVaccination(messenger, awaitedVaccination, userId, amount);
    return;
  }

  // Ждём период для отчёта (после «По дате» или «Направление + дата»)?
  const awaitedPeriod = getAwaitedReportPeriod(userId);
  if (awaitedPeriod) {
    const parsed = parsePeriod(text);
    if (!parsed.ok) {
      // Состояние (включая выбранный город и тип отчёта) НЕ сбрасываем — можно ввести повторно
      await messenger.sendPrivate(userId, PERIOD_USAGE_HINT);
      return;
    }
    clearReportPeriodAwait(userId);

    const filter: ReportFilter =
      awaitedPeriod.city != null
        ? { city: awaitedPeriod.city, from: parsed.range.from, to: parsed.range.to }
        : { from: parsed.range.from, to: parsed.range.to };
    const label = awaitedPeriod.city != null ? `${awaitedPeriod.city}_${parsed.label}` : parsed.label;

    await sendReport(userId, awaitedPeriod.type, filter, label);
    return;
  }

  // Похоже на период, но состояние ожидания потеряно (например, бот перезапускался) —
  // не пытаемся угадать, какой отчёт имелся в виду, просто просим начать заново.
  if (parsePeriod(text).ok) {
    await messenger.sendPrivate(userId, 'Начните заново: /отчет');
    return;
  }

  // Отмена заполнения заявки/вакцинации (независимые черновики — на всякий случай сбрасываем оба)
  if (text === '/отмена') {
    cancelDraft(userId);
    cancelVaccineDraft(userId);
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

      if (canManageVaccinations(me?.role ?? null)) {
        lines.push('/вакцина — добавить запись о вакцинации');
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
        lines.push('/отчет — выгрузка заявок в Excel (кнопки: полный / по направлению / по дате / направление+дата)');
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

    if (cmd === '/отчет' && isDirector) {
      // Всё после "/отчет " целиком — а не text.split(/\s+/)[1], чтобы направления
      // с пробелами в названии ("Москва и область") не резались на части.
      const arg = text.slice(cmd.length).trim();

      if (!arg) {
        // Основной путь — кнопки: сначала тип отчёта (заявки/вакцины), потом фильтры
        await bot.api.sendMessageToUser(Number(userId), 'Какой отчёт нужен?', {
          attachments: [renderReportTypeKeyboard()],
        });
        return;
      }

      // Текстовые аргументы оставлены для совместимости со старым форматом — только заявки
      // (он появился до отчёта по вакцинам). Для вакцин — только через кнопки.
      const parsed = parsePeriod(arg);
      if (parsed.ok) {
        await sendReport(userId, 'req', parsed.range, parsed.label);
        return;
      }

      await sendReport(userId, 'req', { city: arg }, arg);
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
      address: values.address!,
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

    const cities = fullyConfiguredCities();

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

  // Идёт заполнение вакцинации? Отдельный черновик — не связан с заявками.
  const vaccineDraft = getVaccineDraft(userId);
  if (vaccineDraft) {
    if (vaccineDraft.city == null) {
      await messenger.sendPrivate(userId, 'Сначала выберите направление кнопкой выше.');
      return;
    }

    const next = applyVaccineAnswer(userId, text);

    if (next) {
      await messenger.sendPrivate(userId, next);
      return;
    }

    const finished = getVaccineDraft(userId)!;
    const city = finished.city!; // непусто: выше вернулись бы раньше, если бы город не был выбран
    const values = finished.values;
    cancelVaccineDraft(userId);

    // "нет"/"-" → следующая дата не нужна, пусто. Иначе — пробуем разобрать в ISO для отчётов;
    // не разобралось — сохраняем как ввели (не отвергаем ввод, просто не сможем фильтровать по нему).
    const nextDateRaw = values.nextDate!.trim();
    const nextDate = /^(нет|-)$/i.test(nextDateRaw) ? null : (parseDateToIso(nextDateRaw) ?? nextDateRaw);
    // Дата вакцинации — та же логика: ISO для фильтра отчёта по периоду, не разобралось — как ввели.
    const date = parseDateToIso(values.date!) ?? values.date!;

    const result = await publishVaccination(messenger, {
      createdBy: userId,
      date,
      city,
      address: values.address!,
      animal: values.animal!,
      problem: values.problem!,
      priceNote: values.priceNote!,
      clientContacts: values.clientContacts!,
      vaccineType: values.vaccineType!,
      nextDate,
    });

    if (!result.ok) {
      await messenger.sendPrivate(userId, result.error ?? 'Не удалось опубликовать запись о вакцинации.');
      return;
    }

    await messenger.sendPrivate(userId, 'Запись о вакцинации опубликована в рабочем чате.');
    return;
  }

  // Начать новую запись о вакцинации: первый шаг — выбор направления кнопкой
  if (text === '/вакцина') {
    const user = getUser(userId);
    if (!canManageVaccinations(user?.role ?? null)) {
      await messenger.sendPrivate(userId, 'Учёт вакцинаций ведут директор и управляющий.');
      return;
    }

    const cities = fullyConfiguredCities();

    if (cities.length === 0) {
      await messenger.sendPrivate(userId, 'Нет настроенных направлений, обратитесь к директору.');
      return;
    }

    startVaccineDraft(userId);
    await bot.api.sendMessageToUser(
      Number(userId),
      'Новая запись о вакцинации. Выберите направление:\n\n/отмена — прервать',
      { attachments: [renderCitySelectKeyboard(cities, 'vcity')] },
    );
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

  // Выбор направления для новой записи о вакцинации (первый шаг /вакцина)
  if (action === 'vcity') {
    const next = setVaccineDraftCity(userId, value);
    if (next == null) {
      await messenger.answerCallback(eventId, 'Черновик не найден. Начните заново: /вакцина');
      return;
    }
    await messenger.answerCallback(eventId, `Направление: ${value}`);
    await messenger.sendPrivate(userId, next);
    return;
  }

  // /отчет, шаг 1: выбор сущности — rtype:req | rtype:vac. Доступно только директору.
  if (action === 'rtype') {
    if (!canManageRoles(getUser(userId)?.role ?? null)) {
      await messenger.answerCallback(eventId, 'Доступно только директору.');
      return;
    }
    if (value !== 'req' && value !== 'vac') {
      await messenger.answerCallback(eventId, 'Не понял тип отчёта.');
      return;
    }

    await messenger.answerCallback(eventId, value === 'req' ? 'Заявки' : 'Вакцины');
    await bot.api.sendMessageToUser(Number(userId), 'Какой отчёт нужен?', {
      attachments: [renderReportMenuKeyboard(value)],
    });
    return;
  }

  // /отчет, шаг 2: rep:<req|vac>:all|city|date|citydate — тип отчёта пронесён из шага 1 в payload
  if (action === 'rep') {
    if (!canManageRoles(getUser(userId)?.role ?? null)) {
      await messenger.answerCallback(eventId, 'Доступно только директору.');
      return;
    }

    const [reportType, filterKind] = splitFirst(value, ':');
    if (reportType !== 'req' && reportType !== 'vac') {
      await messenger.answerCallback(eventId, 'Не понял тип отчёта. Начните заново: /отчет');
      return;
    }

    if (filterKind === 'all') {
      await messenger.answerCallback(eventId, 'Формирую отчёт…');
      await sendReport(userId, reportType, {}, 'все');
      return;
    }

    if (filterKind === 'city') {
      const cities = fullyConfiguredCities();

      if (cities.length === 0) {
        await messenger.answerCallback(eventId, 'Нет настроенных направлений.');
        return;
      }

      await messenger.answerCallback(eventId, 'Выберите направление');
      await bot.api.sendMessageToUser(Number(userId), 'По какому направлению нужен отчёт?', {
        attachments: [renderCitySelectKeyboard(cities, `repcity:${reportType}`)],
      });
      return;
    }

    if (filterKind === 'date') {
      askReportPeriod(userId, reportType);
      await messenger.answerCallback(eventId, 'Введите период');
      await messenger.sendPrivate(userId, PERIOD_USAGE_HINT);
      return;
    }

    if (filterKind === 'citydate') {
      const cities = fullyConfiguredCities();

      if (cities.length === 0) {
        await messenger.answerCallback(eventId, 'Нет настроенных направлений.');
        return;
      }

      await messenger.answerCallback(eventId, 'Выберите направление');
      await bot.api.sendMessageToUser(Number(userId), 'По какому направлению нужен отчёт? Дату спросим следующим шагом.', {
        attachments: [renderCitySelectKeyboard(cities, `repcd:${reportType}`)],
      });
      return;
    }

    await messenger.answerCallback(eventId, 'Неизвестное действие.');
    return;
  }

  // Выбор направления для отчёта (второй экран после rep:<type>:city). value = "<type>:<Город>".
  if (action === 'repcity') {
    if (!canManageRoles(getUser(userId)?.role ?? null)) {
      await messenger.answerCallback(eventId, 'Доступно только директору.');
      return;
    }
    const [reportType, city] = splitFirst(value, ':');
    if (reportType !== 'req' && reportType !== 'vac') {
      await messenger.answerCallback(eventId, 'Не понял тип отчёта. Начните заново: /отчет');
      return;
    }
    await messenger.answerCallback(eventId, `Направление: ${city}`);
    await sendReport(userId, reportType, { city }, city);
    return;
  }

  // Выбор направления для отчёта «Направление + дата» (второй экран после rep:<type>:citydate) —
  // город и тип запоминаем в состоянии ожидания периода, отчёт соберётся после ввода периода текстом
  if (action === 'repcd') {
    if (!canManageRoles(getUser(userId)?.role ?? null)) {
      await messenger.answerCallback(eventId, 'Доступно только директору.');
      return;
    }
    const [reportType, city] = splitFirst(value, ':');
    if (reportType !== 'req' && reportType !== 'vac') {
      await messenger.answerCallback(eventId, 'Не понял тип отчёта. Начните заново: /отчет');
      return;
    }
    askReportPeriod(userId, reportType, city);
    await messenger.answerCallback(eventId, `Направление: ${city}`);
    await messenger.sendPrivate(userId, PERIOD_USAGE_HINT);
    return;
  }

  const requestId = Number(value);

  if (!action || Number.isNaN(requestId)) {
    await messenger.answerCallback(eventId, 'Не понял нажатие.');
    return;
  }

  const ACTIONS = ['take', 'approve', 'reject', 'cancel', 'close'] as const;
  if (!(ACTIONS as readonly string[]).includes(action)) {
    await messenger.answerCallback(eventId, 'Неизвестное действие.');
    return;
  }

  // take/approve/reject/cancel — по messageId карточки (см. resolveEntityKind); close (кнопка в
  // личке врача) messageId не хранит — резервный путь по id внутри самой resolveEntityKind.
  const cardMessageId = ctx.messageId != null ? String(ctx.messageId) : undefined;
  const kind = resolveEntityKind(requestId, cardMessageId);

  if (kind === null) {
    await messenger.answerCallback(eventId, 'Запись не найдена.');
    return;
  }

  if (kind === 'request') {
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
      case 'cancel':
        await cancelOpenRequest(messenger, requestId, userId, eventId);
        break;
      case 'close':
        await startClosing(messenger, requestId, userId, eventId);
        break;
    }
    return;
  }

  switch (action) {
    case 'take':
      await takeVaccination(messenger, requestId, userId, chatId, eventId);
      break;
    case 'approve':
      await approveVaccinationTake(messenger, requestId, userId, eventId);
      break;
    case 'reject':
      await rejectVaccinationTake(messenger, requestId, userId, eventId);
      break;
    case 'cancel':
      await cancelOpenVaccination(messenger, requestId, userId, eventId);
      break;
    case 'close':
      await startClosingVaccination(messenger, requestId, userId, eventId);
      break;
  }
});
