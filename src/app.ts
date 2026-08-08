import './db/index.js';
import { VK } from 'vk-io';

import { config } from './config.js';
import { VkAdapter } from './adapters/vk/VkAdapter.js';
import { fetchDisplayName } from './adapters/vk/userInfo.js';

import { publishRequest, takeRequest, startClosing, finishClosing } from './domain/requestService.js';
import { canCreateRequest, canManageRoles, type Role } from './domain/models.js';
import { getAwaitedRequest, parseMoney } from './domain/pendingInput.js';
import { startDraft, getDraft, applyAnswer, cancelDraft } from './domain/draft.js';

import { ensureUser, setRole, setDmChatId, getUser, listActiveUsers, removeUser } from './db/usersRepo.js';

const vk = new VK({
  token: config.vkToken,
  pollingGroupId: config.vkGroupId,
});

const messenger = new VkAdapter(vk);

// Первый директор задаётся в .env
if (!getUser(config.directorId)) {
  ensureUser(config.directorId, 'Директор');
}
setRole(config.directorId, 'director');
console.log('Директор:', config.directorId);

vk.updates.on('message_new', async (context) => {
  // Ввод бот принимает только в личке. В беседу он лишь публикует карточки.
  if (context.peerType !== 'user') return;

  const userId = String(context.senderId);
  const displayName = await fetchDisplayName(vk, userId);

  ensureUser(userId, displayName);
  setDmChatId(userId, String(context.peerId));

  // Ждём сумму чека?
  const awaited = getAwaitedRequest(userId);
  if (awaited != null) {
    const amount = parseMoney(context.text ?? '');
    if (amount == null) {
      await context.send('Не понял сумму. Введите число, например: 1500');
      return;
    }
    await finishClosing(messenger, awaited, userId, amount, config.vkChatId);
    return;
  }

  // Отмена
  if (context.text === '/отмена') {
    cancelDraft(userId);
    await context.send('Отменено.');
    return;
  }

  // --- Команды директора ---
  if (context.text?.startsWith('/') || context.text === 'Начать') {
    const me = getUser(userId);
    const isDirector = canManageRoles(me?.role ?? null);
    const [cmd, arg1, arg2] = context.text.trim().split(/\s+/);

    if (cmd === '/помощь' || cmd === '/start' || cmd === '/начать' || cmd === 'Начать') {
        const role = me?.role;
        const lines: string[] = ['Бот заявок.', ''];

        if (!role) {
          lines.push('У вас пока нет роли. Обратитесь к директору.');
          lines.push(`(ваш ID: ${userId})`);
        }

        if (canCreateRequest(role ?? null)) {
          lines.push('/заявка — создать заявку');
          lines.push('/отмена — прервать заполнение');
        }

        if (role === 'doctor') {
          lines.push('Заявки приходят в беседу. Нажмите «Принять» — контакты придут сюда.');
          lines.push('Кнопка «Закрыть заявку» — под контактами.');
        }

        if (isDirector) {
          lines.push('');
          lines.push('Директор:');
          lines.push('/люди — список сотрудников');
          lines.push('/роль <id> <диспетчер|врач|управляющий|директор>');
          lines.push('/уволить <id>');
        }

        await context.send(lines.join('\n'));
        return;
      }

    if (cmd === '/люди' && isDirector) {
      const users = listActiveUsers();
      const lines = users.map(u =>
        `${u.userId} — ${u.displayName} — ${u.role ?? 'без роли'}${u.dmChatId ? '' : ' ⚠️ нет лички'}`
      );
      await context.send(lines.length ? lines.join('\n') : 'Пока никого нет.');
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
        await context.send('Главного директора разжаловать нельзя.');
        return;
      }
      if (!arg1 || !role) {
        await context.send('Формат: /роль <id> <диспетчер|врач|управляющий|директор>');
        return;
      }
      if (!getUser(arg1)) {
        await context.send('Такого пользователя нет. Он должен сначала написать боту.');
        return;
      }
      setRole(arg1, role);
      await context.send(`Готово: ${arg1} → ${arg2}`);
      return;
    }

    if (cmd === '/уволить' && isDirector) {
      if (!arg1 || !getUser(arg1)) {
        await context.send('Формат: /уволить <id>');
        return;
      }
      removeUser(arg1);
      await context.send(`${arg1} удалён.`);
      return;
    }
  }

  // Начать новую заявку
  if (context.text === '/заявка') {
    const user = getUser(userId);
    if (!canCreateRequest(user?.role ?? null)) {
      await context.send('Заявки создают диспетчер, управляющий и директор.');
      return;
    }
    const question = startDraft(userId);
    await context.send(`Новая заявка. ${question}\n\n/отмена — прервать`);
    return;
  }

  // Идёт заполнение?
  const draft = getDraft(userId);
  if (draft) {
    const next = applyAnswer(userId, context.text ?? '');

    if (next) {
      await context.send(next);
      return;
    }

    const values = getDraft(userId)!.values;
    cancelDraft(userId);

    const id = await publishRequest(messenger, config.vkChatId, {
      createdBy: userId,
      date: values.date!,
      city: values.city!,
      animal: values.animal!,
      problem: values.problem!,
      priceNote: values.priceNote!,
      clientContacts: values.clientContacts!,
    });

    await context.send(`Заявка №${id} опубликована в чате.`);
    return;
  }

  // Ничего не подошло
  const me = getUser(userId);
  if (!me?.role) {
    await context.send('Вы зарегистрированы. Директор назначит вам роль.');
    return;
  }
  await context.send('Не понял команду.');
});

vk.updates.on('message_event', async (context) => {
  const payload = context.eventPayload as { cmd: string; id: number };
  console.log('Нажатие:', payload, 'от', context.userId);

  const eventId = JSON.stringify({
    userId: context.userId,
    peerId: context.peerId,
    eventId: context.eventId,
  });

  if (payload?.cmd === 'take') {
    await takeRequest(
      messenger,
      payload.id,
      String(context.userId),
      String(context.peerId),
      eventId,
    );
  }

  if (payload?.cmd === 'close') {
    await startClosing(messenger, payload.id, String(context.userId), eventId);
  }
});

vk.updates.start()
  .then(() => console.log('Бот запущен'))
  .catch(console.error);