import type { Messenger, RequestCard } from '../ports/Messenger.js';
import type { Request } from './models.js';
import { canTakeRequest } from './models.js';
import {
  createRequest,
  getRequest,
  claimRequest,
  closeRequest,
  approveRequest,
  rejectRequest,
  setGroupMessageId,
  type NewRequest,
} from '../db/requestsRepo.js';
import { getUser } from '../db/usersRepo.js';
import { getCityChats } from '../db/cityChatsRepo.js';
import { askAmount, clearAwait } from './pendingInput.js';
import { formatMoney } from './money.js';

function toCard(req: Request, doctorName?: string): RequestCard {
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

/** Диспетчер создал заявку → публикуем в рабочий и управленческий чаты города */
export async function publishRequest(
  messenger: Messenger,
  data: NewRequest,
): Promise<{ ok: boolean; error?: string }> {
  const chats = getCityChats(data.city);
  if (!chats) {
    return { ok: false, error: `Город «${data.city}» не настроен. Обратитесь к директору.` };
  }

  const id = createRequest(data);
  const req = getRequest(id)!;

  // Рабочий чат врачей — нейтральная карточка с кнопкой «Принять»
  const workMsgId = await messenger.sendGroupCard(chats.workChatId, toCard(req));
  setGroupMessageId(id, workMsgId);

  return { ok: true };
}

/** Врач нажал «Принять» */
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

  if (req.groupMessageId) {
    await messenger.editGroupCard(chatId, req.groupMessageId, toCard(req, doctor!.displayName));
  }

  await messenger.sendPrivate(
    doctor!.dmChatId,
    `Заявка №${req.id} ваша.\n\nКонтакты клиента:\n${req.clientContacts}`,
    req.id,
  );

  await messenger.answerCallback(eventId, 'Заявка ваша, контакты в личке');
}

/** Врач нажал «Закрыть» → спрашиваем сумму */
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
  if (req.status !== 'taken') {
    await messenger.answerCallback(eventId, 'Заявка уже закрыта');
    return;
  }

  askAmount(doctorId, requestId);
  await messenger.answerCallback(eventId, 'Введите сумму чека');

  const doctor = getUser(doctorId)!;
  await messenger.sendPrivate(doctor.dmChatId!, `Заявка №${requestId}. Введите сумму чека в рублях, например: 1500`);
}

/** Врач прислал сумму */
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

  if (req.groupMessageId) {
    await messenger.editGroupCard(chatId, req.groupMessageId, toCard(req, doctor.displayName));
  }

  await messenger.sendPrivate(doctor.dmChatId!, `Заявка №${requestId} закрыта. Чек: ${formatMoney(amount)}`);
}