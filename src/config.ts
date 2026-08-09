import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная ${name} в .env`);
  return value;
}

export const config = {
  directorId: required('DIRECTOR_ID'),
  maxToken: required('MAX_TOKEN'),
};