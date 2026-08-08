/** Кого о чём спросили: userId → requestId */
const waitingForAmount = new Map<string, number>();

export function askAmount(userId: string, requestId: number): void {
  waitingForAmount.set(userId, requestId);
}

export function getAwaitedRequest(userId: string): number | undefined {
  return waitingForAmount.get(userId);
}

export function clearAwait(userId: string): void {
  waitingForAmount.delete(userId);
}

/** '1500' → 150000 копеек. Вернёт null, если это не сумма. */
export function parseMoney(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const rubles = parseFloat(cleaned);
  if (rubles <= 0 || rubles > 1_000_000) return null;
  return Math.round(rubles * 100);
}