import type { Messenger, RequestCard } from '../ports/Messenger.js';
import type { Request } from './models.js';
import { canTakeRequest, canApprove, canReject, canCancel } from './models.js';
import {
  createRequest,
  getRequest,
  claimRequest,
  closeRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
  returnRequestToWork as returnRequestToWorkDb,
  setGroupMessageId,
  setManageMessageId,
  type NewRequest,
} from '../db/requestsRepo.js';
import { getUser } from '../db/usersRepo.js';
import { getCityChats } from '../db/cityChatsRepo.js';
import { askAmount, clearAwait, registerDoctorCardEntity } from './pendingInput.js';
import { formatMoney } from './money.js';

/** Рабочий чат врачей: карточка ВСЕГДА нейтральная — без имени принявшего и без суммы чека */
function toGroupCard(req: Request): RequestCard {
  return {
    requestId: req.id,
    date: req.date,
    city: req.city,
    address: req.address,
    animal: req.animal,
    problem: req.problem,
    priceNote: req.priceNote,
    status: req.status,
  };
}

/**
 * Управленческий чат: карточка с деталями — кто принял, сумма чека, и (решение заказчика)
 * контакты клиента ВСЕГДА, на любом статусе — не только после одобрения.
 */
function toManageCard(req: Request, doctorName?: string): RequestCard {
  return {
    requestId: req.id,
    date: req.date,
    city: req.city,
    address: req.address,
    animal: req.animal,
    problem: req.problem,
    priceNote: req.priceNote,
    status: req.status,
    doctorName,
    checkAmount: req.checkAmount ?? undefined,
    clientContacts: req.clientContacts,
  };
}

/**
 * Диспетчер создал заявку → публикуем СРАЗУ в оба чата города: нейтральную карточку в рабочий
 * (кнопка «Принять») и карточку с деталями в управленческий (кнопка «Отменить», пока заявка
 * открыта — до этой правки управленческая карточка появлялась только после takeRequest).
 */
export async function publishRequest(
  messenger: Messenger,
  data: NewRequest,
): Promise<{ ok: boolean; error?: string }> {
  const chats = getCityChats(data.city);
  if (!chats?.workChatId || !chats?.manageChatId) {
    return { ok: false, error: `Оба чата города «${data.city}» должны быть настроены. Обратитесь к директору.` };
  }

  const id = createRequest(data);
  const req = getRequest(id)!;

  const workMsgId = await messenger.sendGroupCard(chats.workChatId, toGroupCard(req));
  setGroupMessageId(id, workMsgId);

  const manageMsgId = await messenger.sendManageCard(chats.manageChatId, toManageCard(req));
  setManageMessageId(id, manageMsgId);

  return { ok: true };
}

/** Врач нажал «Принять». Контакты клиента НЕ отправляются — только после одобрения. */
export async function takeRequest(
  messenger: Messenger,
  requestId: number,
  doctorId: string,
  chatId: string,
  eventId: string,
): Promise<void> {
  const doctor = getUser(doctorId);

  if (!canTakeRequest(doctor?.role ?? null)) {
    await messenger.answerCallback(eventId, 'Принимать заявки может только сотрудник с назначенной ролью — обратитесь к директору');
    return;
  }

  if (!doctor!.dmChatId) {
    await messenger.answerCallback(eventId, 'Сначала напишите боту в личные сообщения');
    return;
  }

  const result = claimRequest(requestId, doctorId);

  if (result === 'already_taken') {
    await messenger.answerCallback(eventId, 'Заявка уже принята');
    return;
  }
  if (result === 'not_found') {
    await messenger.answerCallback(eventId, 'Заявка не найдена');
    return;
  }

  const req = getRequest(requestId)!;

  // Рабочая карточка остаётся нейтральной — врачи не видят, кто принял заявку
  if (req.groupMessageId) {
    await messenger.editGroupCard(chatId, req.groupMessageId, toGroupCard(req));
  }

  // Управленческая карточка уже существует с момента публикации (см. publishRequest) —
  // перерисовываем её с деталями (кто принял), кнопка «Отменить» сменится на «Одобрить»/«Отклонить»
  const chats = getCityChats(req.city);
  if (chats?.manageChatId && req.manageMessageId) {
    await messenger.editManageCard(chats.manageChatId, req.manageMessageId, toManageCard(req, doctor!.displayName));
  }

  await messenger.answerCallback(eventId, 'Заявка принята, ждите одобрения управляющего');
}

/** Управляющий/директор одобрил приём. Единственное место, откуда контакты уходят врачу. */
export async function approveTake(
  messenger: Messenger,
  requestId: number,
  approverId: string,
  eventId: string,
): Promise<void> {
  const approver = getUser(approverId);

  if (!canApprove(approver?.role ?? null)) {
    await messenger.answerCallback(eventId, 'Одобрять приём заявок может только управляющий или директор');
    return;
  }

  const result = approveRequest(requestId);

  if (result === 'not_taken') {
    await messenger.answerCallback(eventId, 'Заявку нельзя одобрить в текущем статусе');
    return;
  }
  if (result === 'not_found') {
    await messenger.answerCallback(eventId, 'Заявка не найдена');
    return;
  }

  const req = getRequest(requestId)!;
  const doctor = getUser(req.assignedDoctorId!);
  const chats = getCityChats(req.city);

  if (chats?.manageChatId && req.manageMessageId) {
    await messenger.editManageCard(chats.manageChatId, req.manageMessageId, toManageCard(req, doctor?.displayName));
  }

  if (doctor?.dmChatId) {
    const dmMessageId = await messenger.sendDoctorCard(
      doctor.dmChatId,
      { ...toManageCard(req, doctor.displayName), clientContacts: req.clientContacts },
      req.id,
    );
    // Регистрируем, чтобы handlers.ts мог отличить кнопку «Закрыть» этой заявки от вакцинации —
    // см. domain/pendingInput.ts.
    registerDoctorCardEntity(dmMessageId, 'request');
  }

  await messenger.answerCallback(eventId, 'Заявка одобрена, контакты отправлены принявшему');
}

/** Управляющий/директор отклонил приём → заявка снова свободна */
export async function rejectTake(
  messenger: Messenger,
  requestId: number,
  approverId: string,
  eventId: string,
): Promise<void> {
  const approver = getUser(approverId);

  if (!canReject(approver?.role ?? null)) {
    await messenger.answerCallback(eventId, 'Отклонять приём заявок может только управляющий или директор');
    return;
  }

  const result = rejectRequest(requestId);

  if (result === 'not_taken') {
    await messenger.answerCallback(eventId, 'Заявку нельзя отклонить в текущем статусе');
    return;
  }
  if (result === 'not_found') {
    await messenger.answerCallback(eventId, 'Заявка не найдена');
    return;
  }

  const req = getRequest(requestId)!;
  const chats = getCityChats(req.city);

  // Рабочая карточка снова открыта — кнопка «Принять» доступна другим врачам
  if (chats?.workChatId && req.groupMessageId) {
    await messenger.editGroupCard(chats.workChatId, req.groupMessageId, toGroupCard(req));
  }

  // Управленческая карточка тоже возвращается в нейтральное состояние (без принявшего врача)
  if (chats?.manageChatId && req.manageMessageId) {
    await messenger.editManageCard(chats.manageChatId, req.manageMessageId, toManageCard(req));
  }

  await messenger.answerCallback(eventId, 'Заявка отклонена и снова открыта');
}

/** Диспетчер/управляющий/директор отменил ОТКРЫТУЮ (ещё не принятую врачом) заявку */
export async function cancelOpenRequest(
  messenger: Messenger,
  requestId: number,
  actorId: string,
  eventId: string,
): Promise<void> {
  const actor = getUser(actorId);

  if (!canCancel(actor?.role ?? null)) {
    await messenger.answerCallback(eventId, 'Отменять заявки может диспетчер, управляющий или директор');
    return;
  }

  const result = cancelRequest(requestId);

  if (result === 'not_open') {
    await messenger.answerCallback(eventId, 'Отменить можно только открытую (ещё не принятую) заявку');
    return;
  }
  if (result === 'not_found') {
    await messenger.answerCallback(eventId, 'Заявка не найдена');
    return;
  }

  const req = getRequest(requestId)!;
  const chats = getCityChats(req.city);

  // Рабочая карточка — «Отменена», кнопка «Принять» пропадает
  if (chats?.workChatId && req.groupMessageId) {
    await messenger.editGroupCard(chats.workChatId, req.groupMessageId, toGroupCard(req));
  }

  // Управленческая карточка — тоже «Отменена», без кнопок
  if (chats?.manageChatId && req.manageMessageId) {
    await messenger.editManageCard(chats.manageChatId, req.manageMessageId, toManageCard(req));
  }

  await messenger.answerCallback(eventId, 'Заявка отменена');
}

/**
 * Форс-мажор: диспетчер/управляющий/директор вернул ОДОБРЕННУЮ заявку в работу (например, врач
 * не может приехать) — статус 'approved' → 'open', снятие врача. Права — те же, что у одобрения
 * (canApprove). Снятого врача уведомляем личным сообщением — карточка/контакты у него уже есть
 * и никуда не денутся (необратимо, заказчик в курсе и это принимает).
 */
export async function returnRequestToWork(
  messenger: Messenger,
  requestId: number,
  actorId: string,
  eventId: string,
): Promise<void> {
  const actor = getUser(actorId);

  if (!canApprove(actor?.role ?? null)) {
    await messenger.answerCallback(eventId, 'Возвращать заявку в работу может только диспетчер, управляющий или директор');
    return;
  }

  // Читаем ДО перехода — assigned_doctor_id обнулится, а снятого врача ещё нужно уведомить.
  const before = getRequest(requestId);
  const previousDoctor = before?.assignedDoctorId ? getUser(before.assignedDoctorId) : null;

  const result = returnRequestToWorkDb(requestId);

  if (result === 'not_approved') {
    await messenger.answerCallback(eventId, 'Вернуть в работу можно только одобренную заявку');
    return;
  }
  if (result === 'not_found') {
    await messenger.answerCallback(eventId, 'Заявка не найдена');
    return;
  }

  const req = getRequest(requestId)!;
  const chats = getCityChats(req.city);

  // Рабочая карточка снова открыта — кнопка «Принять» доступна любому врачу
  if (chats?.workChatId && req.groupMessageId) {
    await messenger.editGroupCard(chats.workChatId, req.groupMessageId, toGroupCard(req));
  }

  // Управленческая карточка тоже возвращается в нейтральное состояние (без принявшего врача)
  if (chats?.manageChatId && req.manageMessageId) {
    await messenger.editManageCard(chats.manageChatId, req.manageMessageId, toManageCard(req));
  }

  if (previousDoctor?.dmChatId) {
    await messenger.sendPrivate(previousDoctor.dmChatId, `Заявка №${requestId} снята с вас и возвращена в работу.`);
  }

  await messenger.answerCallback(eventId, 'Заявка возвращена в работу');
}

/** Врач нажал «Закрыть» → спрашиваем сумму. Доступно только после одобрения. */
export async function startClosing(
  messenger: Messenger,
  requestId: number,
  doctorId: string,
  eventId: string,
): Promise<void> {
  const req = getRequest(requestId);

  if (!req || req.assignedDoctorId !== doctorId) {
    await messenger.answerCallback(eventId, 'Это не ваша заявка');
    return;
  }
  if (req.status !== 'approved') {
    await messenger.answerCallback(eventId, 'Заявка ещё не одобрена или уже закрыта');
    return;
  }

  askAmount(doctorId, requestId);
  await messenger.answerCallback(eventId, 'Введите сумму чека');

  const doctor = getUser(doctorId)!;
  await messenger.sendPrivate(doctor.dmChatId!, `Заявка №${requestId}. Введите сумму чека в рублях, например: 1500`);
}

/** Врач прислал сумму → закрытие возможно только из статуса approved */
export async function finishClosing(
  messenger: Messenger,
  requestId: number,
  doctorId: string,
  amount: number,
  chatId: string,
): Promise<void> {
  const result = closeRequest(requestId, doctorId, amount);
  const doctor = getUser(doctorId)!;

  if (result !== 'ok') {
    clearAwait(doctorId);
    await messenger.sendPrivate(doctor.dmChatId!, 'Не удалось закрыть заявку.');
    return;
  }

  clearAwait(doctorId);
  const req = getRequest(requestId)!;
  const chats = getCityChats(req.city);

  // Рабочая карточка — нейтрально «закрыто», без суммы и имени врача
  if (chats?.workChatId && req.groupMessageId) {
    await messenger.editGroupCard(chats.workChatId, req.groupMessageId, toGroupCard(req));
  }

  // Управленческая карточка — с итоговой суммой чека
  if (chats?.manageChatId && req.manageMessageId) {
    await messenger.editManageCard(chats.manageChatId, req.manageMessageId, toManageCard(req, doctor.displayName));
  }

  await messenger.sendPrivate(doctor.dmChatId!, `Заявка №${requestId} закрыта. Чек: ${formatMoney(amount)}`);
}
