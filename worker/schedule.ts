// 維持アルゴリズム (設計 5)。
// 評価は「今日の演奏の結果」ではなく「いま、この曲がどれくらい弾ける状態か」の判定。
import { addDays, diffDays } from './dates';
import type { Piece, Rating, Settings } from '../shared/types';

const EASE_DELTA: Record<Rating, number> = {
  excellent: 0.05,
  good: 0,
  shaky: -0.1,
  lost: -0.15,
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function multiplier(rating: Rating, s: Settings): number {
  switch (rating) {
    case 'excellent':
      return s.mult_excellent;
    case 'good':
      return s.mult_good;
    case 'shaky':
      return s.mult_shaky;
    case 'lost':
      return 0; // 使わない (lost は 1 日にリセット)
  }
}

export interface ScheduleResult {
  interval_days: number;
  ease: number;
  next_due: string;
}

/**
 * 評価を1つ適用して、次の間隔・ease・次回予定日を求める。
 * 次の間隔 = clamp(現在の間隔 × 倍率 × ease, 1日, 上限)。× は 1 日にリセット。
 */
export function applyRating(
  current: { interval_days: number; ease: number },
  rating: Rating,
  playedOn: string,
  s: Settings,
): ScheduleResult {
  const ease = clamp(current.ease + EASE_DELTA[rating], s.ease_min, s.ease_max);
  const interval =
    rating === 'lost'
      ? 1
      : clamp(
          Math.round(current.interval_days * multiplier(rating, s) * current.ease),
          1,
          s.max_interval_days,
        );
  return { interval_days: interval, ease, next_due: addDays(playedOn, interval) };
}

/**
 * 休眠/復活中 → 人前で弾ける への昇格 (設計 Q35)。
 * 基準間隔(既定 3 日)・ease 1.0 を出発点に、その場の評価を1回適用する。
 * ◎→8日 / ○→5日 / △→2日 / ×→1日
 */
export function promote(rating: Rating, playedOn: string, s: Settings): ScheduleResult {
  return applyRating({ interval_days: s.base_interval_days, ease: 1.0 }, rating, playedOn, s);
}

/** 維持状態 (自動算出、手で触れない)。active 以外は状態を持たない */
export type MaintenanceState = 'ok' | 'today' | 'review';

export function maintenanceState(piece: Piece, today: string): MaintenanceState | null {
  if (piece.status !== 'active' || !piece.next_due) return null;
  const overdue = diffDays(today, piece.next_due);
  if (piece.last_rating === 'shaky' || piece.last_rating === 'lost') return 'review';
  if (overdue > piece.interval_days) return 'review';
  if (overdue >= 0) return 'today';
  return 'ok';
}

export function overdueDays(piece: Piece, today: string): number {
  if (piece.status !== 'active' || !piece.next_due) return 0;
  return diffDays(today, piece.next_due);
}

/**
 * 今日の維持練習リスト。
 * 予定日が到来した active 曲を「要復習 → 超過日数の大きい順」に並べ、上限で切る。
 * 溢れた分は翌日以降へ自動的に繰り越される (何もしないだけで翌日も超過として残る)。
 */
export function todaysPractice(pieces: Piece[], today: string, limit: number): Piece[] {
  return pieces
    .filter((p) => p.status === 'active' && p.next_due !== null && overdueDays(p, today) >= 0)
    .sort((a, b) => {
      const ra = maintenanceState(a, today) === 'review' ? 1 : 0;
      const rb = maintenanceState(b, today) === 'review' ? 1 : 0;
      if (ra !== rb) return rb - ra;
      return overdueDays(b, today) - overdueDays(a, today);
    })
    .slice(0, limit);
}
