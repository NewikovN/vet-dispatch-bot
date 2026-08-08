import type { VK } from 'vk-io';

const cache = new Map<string, string>();

export async function fetchDisplayName(vk: VK, userId: string): Promise<string> {
  const cached = cache.get(userId);
  if (cached) return cached;

  try {
    const [user] = await vk.api.users.get({ user_ids: [userId] });
    const name = `${user.first_name} ${user.last_name}`.trim();
    cache.set(userId, name);
    return name;
  } catch (err) {
    console.error('Не удалось получить имя:', userId, err);
    return `id${userId}`;
  }
}