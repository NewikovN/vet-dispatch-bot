import type { Messenger, RequestCard } from '../ports/Messenger.js';
import type { Request } from './models.js';
import { canTakeRequest, canApprove, canReject } from './models.js';
import {
  createRequest,
  getRequest,
  claimRequest,
  closeRequest,
  approveRequest,
  rejectRequest,
  setGroupMessageId,
  setManageMessageId,
  type NewRequest,
} from '../db/requestsRepo.js';
import { getUser } from '../db/usersRepo.js';
import { getCityChats } from '../db/cityChatsRepo.js';
import { askAmount, clearAwait } from './pendingInput.js';
import { formatMoney } from './money.js';

/** Рабочий чат врачей: карточка ВСЕГДА нейтральная — без имени принявшего и без суммы чека */
function toGroupCard(req: Request): RequestCard {
  return {
    requestId: req.id,
    date: req.date,
    city: req.city,
    animal: req.animal,
    problem: req.problem,
    priceNote: req.priceNote,
    status: req.status,
  };
}

/** Управленческий чат: карточка с деталями — кто принял, сумма чека */
function toManageCard(req: Request, doctorName?: string): RequestCard {
  return {
    requestId: req.id,
    date: req.date,
    city: req.city,
    animal: req.animal,
    problem: req.problem,
    priceNote: req.priceNote,
    status: req.status,
    doctorName,
    checkAmount: req.checkAmount ?? undefined,
  };
}

/** Диспетчер создал заявку → публикуем нейтральную карточку в рабочий чат города */
export async function publishRequest(
  messenger: Messenger,
  data: NewRequest,
): Promise<{ ok: boolean; error?: string }> {
  const chats = getCityChats(data.city);
  if (!chats?.workChatId) {
    return { ok: false, error: `Рабочий чат города «${data.city}» не настроен. Обратитесь к директору.` };
  }

  const id = createRequest(data);
  const req = getRequest(id)!;

  const workMsgId = await messenger.sendGroupCard(chats.workChatId, toGroupCard(req));
  setGroupMessageId(id, workMsgId);

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
    await messenger.answerCallback(eventId, 'Заявки принимают только врачи');
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

  // Управленческая карточка — с деталями, для решения об одобрении
  const chats = getCityChats(req.city);
  if (chats?.manageChatId) {
    const manageMsgId = await messenger.sendManageCard(chats.manageChatId, toManageCard(req, doctor!.displayName));
    setManageMessageId(req.id, manageMsgId);
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
    await messenger.sendPrivate(
      doctor.dmChatId,
      `Заявка №${req.id} одобрена.\n\nКонтакты клиента:\n${req.clientContacts}`,
      req.id,
    );
  }

  await messenger.answerCallback(eventId, 'Заявка одобрена, контакты отправлены врачу');
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
