import { Bot } from '@maxhub/max-bot-api';
import { config } from '../../config.js';

// baseUrl не задаём явно — библиотека по умолчанию использует https://platform-api2.max.ru
// (проверено разведкой пакета: dist/core/network/api/client.js, defaultOptions.baseUrl).
export const bot = new Bot(config.maxToken);
