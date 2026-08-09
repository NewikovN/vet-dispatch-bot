export function formatMoney(kopecks: number): string {
  return (kopecks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + ' ₽';
}

/** Копейки → рубли числом (для Excel и прочих мест, где нужна величина, а не готовая строка) */
export function toRubles(kopecks: number): number {
  return kopecks / 100;
}