import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная ${name} в .env`);
  return value;
}

export const config = {
  vkToken: required('VK_TOKEN'),
  vkGroupId: Number(required('VK_GROUP_ID')),
  vkChatId: required('VK_CHAT_ID'),
  directorId: required('DIRECTOR_ID'),
};