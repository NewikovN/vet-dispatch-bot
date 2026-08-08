export function formatMoney(kopecks: number): string {
  return (kopecks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) + ' ₽';
}