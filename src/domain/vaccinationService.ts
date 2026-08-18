/**
 * Сервисный слой вакцинации — по структуре requestService.ts (жизненный цикл
 * open → taken → approved → closed/cancelled), но ОТДЕЛЬНЫЙ файл, а не обобщение requestService.
 *
 * Почему отдельный файл, а не один generic-движок на оба репозитория:
 * - requestsRepo.ts/vaccinationsRepo.ts осознанно раздельные (requests и vaccinations —
 *   разные таблицы, жёсткое требование заказчика), и уже сами по себе параллельны друг другу
 *   (claimRequest/claimVaccination и т.д.) — переиспользование СИНХРОНИЗИРОВАНО на уровне БД
 *   через общий db/workflowRepo.ts, дублировать это ещё и в сервисном слое незачем.
 * - pendingInput.ts хранит «кого ждём с суммой чека» как userId → id БЕЗ типа сущности. Общая
 *   карта на requests и vaccinations не различила бы, заявку или вакцинацию закрывает врач,
 *   если их id совпадут. Раз нужна отдельная карта ожидания (askVaccinationAmount/
 *   getAwaitedVaccination/clearVaccinationAwait, см. pendingInput.ts), логично держать
 *   параллельным и сам сервис — не городить общий движок поверх двух параллельных наборов
 *   состояния ради экономии кода, который и так в основном декларативный.
 * - Права (canTakeRequest/canApprove/canReject/canCancel из domain/models.ts) уже общие —
 *   переиспользуются как есть, не продублированы.
 */
import type { Messenger, RequestCard } from '../ports/Messenger.js';
import type { Vaccination } from './models.js';
import { canTakeRequest, canApprove, canReject, canCancel, canReturnToWork } from './models.js';
import {
  createVaccination,
  getVaccination,
  claimVaccination,
  closeVaccination,
  approveVaccination,
  rejectVaccination,
  cancelVaccination,
  returnVaccinationToWork as returnVaccinationToWorkDb,
  setGroupMessageId,
  setManageMessageId,
  type NewVaccination,
} from '../db/vaccinationsRepo.js';
import { getUser } from '../db/usersRepo.js';
import { getCityChats } from '../db/cityChatsRepo.js';
import { askVaccinationAmount, clearVaccinationAwait, registerDoctorCardEntity } from './pendingInput.js';
import { formatMoney } from './money.js';

/** Рабочий чат врачей: карточка ВСЕГДА нейтральная — без имени принявшего и без суммы чека */
function toGroupCard(vac: Vaccination): RequestCard {
  return {
    requestId: vac.id,
    date: vac.date,
    city: vac.city,
    address: vac.address,
    animal: vac.animal,
    problem: vac.problem,
    priceNote: vac.priceNote,
    status: vac.status,
    vaccineType: vac.vaccineType,
    nextDate: vac.nextDate,
  };
}

/**
 * Управленческий чат: карточка с деталями — кто принял, сумма чека, и (решение заказчика)
 * контакты клиента ВСЕГДА, на любом статусе — не только после одобрения.
 *
 * Экспортирована (не только для внутреннего использования в этом файле) — нужна
 * scripts/refresh-approved-cards.ts, чтобы пересобрать карточку без дублирования логики.
 */
export function toManageCard(vac: Vaccination, doctorName?: string): RequestCard {
  return {
    requestId: vac.id,
    date: vac.date,
    city: vac.city,
    address: vac.address,
    animal: vac.animal,
    problem: vac.problem,
    priceNote: vac.priceNote,
    status: vac.status,
    doctorName,
    checkAmount: vac.checkAmount ?? undefined,
    vaccineType: vac.vaccineType,
    nextDate: vac.nextDate,
    clientContacts: vac.clientContacts,
  };
}

/**
 * Управляющий/директор/диспетчер создал запись о вакцинации → публикуем СРАЗУ в оба чата города:
 * нейтральную карточку в рабочий (кнопка «Принять») и карточку с деталями в управленческий
 * (кнопка «Отменить», пока запись открыта) — та же схема, что publishRequest в requestService.ts.
 */
export async function publishVaccination(
  messenger: Messenger,
  data: NewVaccination,
): Promise<{ ok: boolean; error?: string }> {
  const chats = getCityChats(data.city);
  if (!chats?.workChatId || !chats?.manageChatId) {
    return { ok: false, error: `Оба чата города «${data.city}» должны быть настроены. Обратитесь к директору.` };
  }

  const id = createVaccination(data);
  const vac = getVaccination(id)!;

  const workMsgId = await messenger.sendGroupCard(chats.workChatId, toGroupCard(vac));
  setGroupMessageId(id, workMsgId);

  const manageMsgId = await messenger.sendManageCard(chats.manageChatId, toManageCard(vac));
  setManageMessageId(id, manageMsgId);

  return { ok: true };
}

/** Врач нажал «Принять». Контакты клиента НЕ отправляются — только после одобрения. */
export async function takeVaccination(
  messenger: Messenger,
  vaccinationId: number,
  doctorId: string,
  chatId: string,
  eventId: string,
): Promise<void> {
  const doctor = getUser(doctorId);

  if (!canTakeRequest(doctor?.role ?? null)) {
    await messenger.answerCallback(eventId, 'Принимать записи о вакцинации может только сотрудник с назначенной ролью — обратитесь к директору');
    return;
  }

  if (!doctor!.dmChatId) {
    await messenger.answerCallback(eventId, 'Сначала напишите боту в личные сообщения');
    return;
  }

  const result = claimVaccination(vaccinationId, doctorId);

  if (result === 'already_taken') {
    await messenger.answerCallback(eventId, 'Запись уже принята');
    return;
  }
  if (result === 'not_found') {
    await messenger.answerCallback(eventId, 'Запись не найдена');
    return;
  }

  const vac = getVaccination(vaccinationId)!;

  // Рабочая карточка остаётся нейтральной — врачи не видят, кто принял запись
  if (vac.groupMessageId) {
    await messenger.editGroupCard(chatId, vac.groupMessageId, toGroupCard(vac));
  }

  // Управленческая карточка уже существует с момента публикации (см. publishVaccination) —
  // перерисовываем её с деталями (кто принял), кнопка «Отменить» сменится на «Одобрить»/«Отклонить»
  const chats = getCityChats(vac.city);
  if (chats?.manageChatId && vac.manageMessageId) {
    await messenger.editManageCard(chats.manageChatId, vac.manageMessageId, toManageCard(vac, doctor!.displayName));
  }

  await messenger.answerCallback(eventId, 'Запись принята, ждите одобрения управляющего');
}

/** Управляющий/директор/диспетчер одобрил приём. Единственное место, откуда контакты уходят врачу. */
export async function approveVaccinationTake(
  messenger: Messenger,
  vaccinationId: number,
  approverId: string,
  eventId: string,
): Promise<void> {
  const approver = getUser(approverId);

  if (!canApprove(approver?.role ?? null)) {
    await messenger.answerCallback(eventId, 'Одобрять приём записей может только управляющий, директор или диспетчер');
    return;
  }

  const result = approveVaccination(vaccinationId);

  if (result === 'not_taken') {
    await messenger.answerCallback(eventId, 'Запись нельзя одобрить в текущем статусе');
    return;
  }
  if (result === 'not_found') {
    await messenger.answerCallback(eventId, 'Запись не найдена');
    return;
  }

  const vac = getVaccination(vaccinationId)!;
  const doctor = getUser(vac.assignedDoctorId!);
  const chats = getCityChats(vac.city);

  if (chats?.manageChatId && vac.manageMessageId) {
    await messenger.editManageCard(chats.manageChatId, vac.manageMessageId, toManageCard(vac, doctor?.displayName));
  }

  if (doctor?.dmChatId) {
    const dmMessageId = await messenger.sendDoctorCard(
      doctor.dmChatId,
      { ...toManageCard(vac, doctor.displayName), clientContacts: vac.clientContacts },
      vac.id,
    );
    // Регистрируем, чтобы handlers.ts мог отличить кнопку «Закрыть» этой вакцинации от заявки —
    // см. domain/pendingInput.ts.
    registerDoctorCardEntity(dmMessageId, 'vaccination');
  }

  await messenger.answerCallback(eventId, 'Запись одобрена, контакты отправлены принявшему');
}

/** Управляющий/директор/диспетчер отклонил приём → запись снова свободна */
export async function rejectVaccinationTake(
  messenger: Messenger,
  vaccinationId: number,
  approverId: string,
  eventId: string,
): Promise<void> {
  const approver = getUser(approverId);

  if (!canReject(approver?.role ?? null)) {
    await messenger.answerCallback(eventId, 'Отклонять приём записей может только управляющий, директор или диспетчер');
    return;
  }

  const result = rejectVaccination(vaccinationId);

  if (result === 'not_taken') {
    await messenger.answerCallback(eventId, 'Запись нельзя отклонить в текущем статусе');
    return;
  }
  if (result === 'not_found') {
    await messenger.answerCallback(eventId, 'Запись не найдена');
    return;
  }

  const vac = getVaccination(vaccinationId)!;
  const chats = getCityChats(vac.city);

  // Рабочая карточка снова открыта — кнопка «Принять» доступна другим врачам
  if (chats?.workChatId && vac.groupMessageId) {
    await messenger.editGroupCard(chats.workChatId, vac.groupMessageId, toGroupCard(vac));
  }

  // Управленческая карточка тоже возвращается в нейтральное состояние (без принявшего врача)
  if (chats?.manageChatId && vac.manageMessageId) {
    await messenger.editManageCard(chats.manageChatId, vac.manageMessageId, toManageCard(vac));
  }

  await messenger.answerCallback(eventId, 'Запись отклонена и снова открыта');
}

/** Диспетчер/управляющий/директор отменил ОТКРЫТУЮ (ещё не принятую врачом) запись */
export async function cancelOpenVaccination(
  messenger: Messenger,
  vaccinationId: number,
  actorId: string,
  eventId: string,
): Promise<void> {
  const actor = getUser(actorId);

  if (!canCancel(actor?.role ?? null)) {
    await messenger.answerCallback(eventId, 'Отменять записи о вакцинации может диспетчер, управляющий или директор');
    return;
  }

  const result = cancelVaccination(vaccinationId);

  if (result === 'not_open') {
    await messenger.answerCallback(eventId, 'Отменить можно только открытую (ещё не принятую) запись');
    return;
  }
  if (result === 'not_found') {
    await messenger.answerCallback(eventId, 'Запись не найдена');
    return;
  }

  const vac = getVaccination(vaccinationId)!;
  const chats = getCityChats(vac.city);

  // Рабочая карточка — «Отменена», кнопка «Принять» пропадает
  if (chats?.workChatId && vac.groupMessageId) {
    await messenger.editGroupCard(chats.workChatId, vac.groupMessageId, toGroupCard(vac));
  }

  // Управленческая карточка — тоже «Отменена», без кнопок
  if (chats?.manageChatId && vac.manageMessageId) {
    await messenger.editManageCard(chats.manageChatId, vac.manageMessageId, toManageCard(vac));
  }

  await messenger.answerCallback(eventId, 'Запись отменена');
}

/**
 * Форс-мажор: ДИРЕКТОР вернул ОДОБРЕННУЮ запись в работу (например, врач не может приехать) —
 * статус 'approved' → 'open', снятие врача. Права — уточнение заказчика после того, как увидел
 * готовую фичу: НЕ canApprove (изначально было доступно диспетчеру/управляющему/директору), а
 * отдельная canReturnToWork — только директор. Снятого врача уведомляем личным сообщением —
 * карточка/контакты у него уже есть и никуда не денутся (необратимо, заказчик в курсе и это
 * принимает).
 *
 * Рабочая карточка: НЕ просто editGroupCard на месте — если чат наспамили другими сообщениями,
 * актуальную кнопку «Принять» никто не заметит. Старое сообщение помечается текстом без кнопки
 * (markGroupCardMoved), новая карточка с кнопкой отправляется заново внизу чата (sendGroupCard),
 * group_message_id в БД переключается на новый id — дальнейшие действия (принять/закрыть и т.д.)
 * бьют уже по новому сообщению. Управленческую карточку это не касается — просто editManageCard,
 * там и так внимательно следят за чатом.
 */
export async function returnVaccinationToWork(
  messenger: Messenger,
  vaccinationId: number,
  actorId: string,
  eventId: string,
): Promise<void> {
  const actor = getUser(actorId);

  if (!canReturnToWork(actor?.role ?? null)) {
    await messenger.answerCallback(eventId, 'Возвращать запись в работу может только директор');
    return;
  }

  // Читаем ДО перехода — assigned_doctor_id обнулится, а снятого врача ещё нужно уведомить.
  const before = getVaccination(vaccinationId);
  const previousDoctor = before?.assignedDoctorId ? getUser(before.assignedDoctorId) : null;

  const result = returnVaccinationToWorkDb(vaccinationId);

  if (result === 'not_approved') {
    await messenger.answerCallback(eventId, 'Вернуть в работу можно только одобренную запись');
    return;
  }
  if (result === 'not_found') {
    await messenger.answerCallback(eventId, 'Запись не найдена');
    return;
  }

  const vac = getVaccination(vaccinationId)!;
  const chats = getCityChats(vac.city);

  // Старая рабочая карточка — «переехала», без кнопки; новая — заново внизу чата, с кнопкой
  // «Принять» на виду. group_message_id переключаем на новое сообщение.
  if (chats?.workChatId && vac.groupMessageId) {
    await messenger.markGroupCardMoved(
      chats.workChatId,
      vac.groupMessageId,
      `Запись №${vaccinationId} перемещена — см. новое сообщение ниже.`,
    );
    const newGroupMessageId = await messenger.sendGroupCard(chats.workChatId, toGroupCard(vac));
    setGroupMessageId(vaccinationId, newGroupMessageId);
  }

  // Управленческая карточка тоже возвращается в нейтральное состояние (без принявшего врача)
  if (chats?.manageChatId && vac.manageMessageId) {
    await messenger.editManageCard(chats.manageChatId, vac.manageMessageId, toManageCard(vac));
  }

  if (previousDoctor?.dmChatId) {
    await messenger.sendPrivate(previousDoctor.dmChatId, `Запись №${vaccinationId} снята с вас и возвращена в работу.`);
  }

  await messenger.answerCallback(eventId, 'Запись возвращена в работу');
}

/** Врач нажал «Закрыть» → спрашиваем сумму. Доступно только после одобрения. */
export async function startClosingVaccination(
  messenger: Messenger,
  vaccinationId: number,
  doctorId: string,
  eventId: string,
): Promise<void> {
  const vac = getVaccination(vaccinationId);

  if (!vac || vac.assignedDoctorId !== doctorId) {
    await messenger.answerCallback(eventId, 'Это не ваша запись');
    return;
  }
  if (vac.status !== 'approved') {
    await messenger.answerCallback(eventId, 'Запись ещё не одобрена или уже закрыта');
    return;
  }

  askVaccinationAmount(doctorId, vaccinationId);
  await messenger.answerCallback(eventId, 'Введите сумму чека');

  const doctor = getUser(doctorId)!;
  await messenger.sendPrivate(
    doctor.dmChatId!,
    `Запись №${vaccinationId}. Введите сумму чека в рублях, например: 1500`,
  );
}

/** Врач прислал сумму → закрытие возможно только из статуса approved */
export async function finishClosingVaccination(
  messenger: Messenger,
  vaccinationId: number,
  doctorId: string,
  amount: number,
): Promise<void> {
  const result = closeVaccination(vaccinationId, doctorId, amount);
  const doctor = getUser(doctorId)!;

  if (result !== 'ok') {
    clearVaccinationAwait(doctorId);
    await messenger.sendPrivate(doctor.dmChatId!, 'Не удалось закрыть запись.');
    return;
  }

  clearVaccinationAwait(doctorId);
  const vac = getVaccination(vaccinationId)!;
  const chats = getCityChats(vac.city);

  // Рабочая карточка — нейтрально «закрыто», без суммы и имени врача
  if (chats?.workChatId && vac.groupMessageId) {
    await messenger.editGroupCard(chats.workChatId, vac.groupMessageId, toGroupCard(vac));
  }

  // Управленческая карточка — с итоговой суммой чека
  if (chats?.manageChatId && vac.manageMessageId) {
    await messenger.editManageCard(chats.manageChatId, vac.manageMessageId, toManageCard(vac, doctor.displayName));
  }

  await messenger.sendPrivate(doctor.dmChatId!, `Запись №${vaccinationId} закрыта. Чек: ${formatMoney(amount)}`);
}
