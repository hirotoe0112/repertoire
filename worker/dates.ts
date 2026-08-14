// 日付はすべて JST 固定で扱う (設計 9)。JST は夏時間が無いので UTC+9 の単純な加算で足りる。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JST の 'YYYY-MM-DD' */
export function jstDate(at: Date = new Date()): string {
  return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST の時 (0-23) */
export function jstHour(at: Date = new Date()): number {
  return new Date(at.getTime() + JST_OFFSET_MS).getUTCHours();
}

/** JST の日 (1-31)。月初判定に使う */
export function jstDayOfMonth(at: Date = new Date()): number {
  return new Date(at.getTime() + JST_OFFSET_MS).getUTCDate();
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** a - b を日数で。a が b より後なら正 */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

export function nowIso(): string {
  return new Date().toISOString();
}
