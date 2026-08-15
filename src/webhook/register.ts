/**
 * Управление подпиской на webhook у MAX: POST/GET/DELETE /subscriptions.
 *
 * Библиотека @maxhub/max-bot-api эти эндпоинты вообще не моделирует (RawApi.get/post/patch
 * типизированы закрытым списком путей — 'subscriptions' там нет ни в одном из них), поэтому
 * зовём platform-api2.max.ru напрямую через fetch — та же техника и тот же домен/заголовок
 * авторизации, что и в MaxAdapter.sendDocument (тоже обход того, чего нет в библиотеке).
 *
 * Контракт подтверждён по официальной документации (dev.max.ru/docs-api):
 * - POST /subscriptions: body { url, update_types?, secret? }, secret 5-256 симв., шлётся
 *   потом в заголовке X-Max-Bot-Api-Secret на каждый webhook-запрос;
 * - GET /subscriptions: { subscriptions: Subscription[] };
 * - DELETE /subscriptions?url=<url>: убирает конкретную подписку по её url (query-параметр).
 * Токен — только в заголовке Authorization, без "Bearer" (как и everywhere в проекте).
 */
import { config } from '../config.js';

const API_BASE = 'https://platform-api2.max.ru';

export const WEBHOOK_UPDATE_TYPES = ['message_created', 'message_callback', 'bot_started', 'bot_added'];

export interface Subscription {
  url: string;
  update_types?: string[];
  time?: number;
}

async function maxFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: config.maxToken,
      'content-type': 'application/json',
    },
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(`MAX API ${init.method ?? 'GET'} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }

  return data as T;
}

export async function listWebhooks(): Promise<Subscription[]> {
  const data = await maxFetch<{ subscriptions: Subscription[] }>('/subscriptions');
  return data.subscriptions ?? [];
}

async function deleteWebhookByUrl(url: string): Promise<void> {
  await maxFetch(`/subscriptions?url=${encodeURIComponent(url)}`, { method: 'DELETE' });
}

/** Удаляет ВСЕ текущие подписки — используется и для возврата на long polling, и перед регистрацией новой. */
export async function deleteWebhook(): Promise<void> {
  const existing = await listWebhooks();
  for (const sub of existing) {
    await deleteWebhookByUrl(sub.url);
  }
}

/** Регистрирует webhook: сначала убирает старые подписки (webhook и polling взаимоисключающи), потом ставит новую. */
export async function registerWebhook(url: string, secret: string): Promise<void> {
  await deleteWebhook();

  await maxFetch('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      url,
      update_types: WEBHOOK_UPDATE_TYPES,
      secret,
    }),
  });
}
