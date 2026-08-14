// フロントとワーカーで共有する型。src からも import する。

/** ◎ / ○ / △ / × */
export type Rating = 'excellent' | 'good' | 'shaky' | 'lost';

/** 軸1: 習熟段階 (手で動かす) */
export type Status = 'active' | 'reviving' | 'dormant';

export const RATING_LABEL: Record<Rating, string> = {
  excellent: '◎',
  good: '○',
  shaky: '△',
  lost: '×',
};

export const RATING_DESC: Record<Rating, string> = {
  excellent: 'いま人前で通せる',
  good: 'だいたい大丈夫、細部が不安',
  shaky: '怪しい箇所がある',
  lost: '弾けなくなっている',
};

export const STATUS_LABEL: Record<Status, string> = {
  active: '人前で弾ける',
  reviving: '復活中',
  dormant: '休眠',
};

export interface Piece {
  id: number;
  composer: string;
  title: string;
  status: Status;
  memorized: boolean;
  interval_days: number;
  ease: number;
  next_due: string | null;
  last_played_on: string | null;
  last_rating: Rating | null;
  last_performed_on: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

/** 軸2: 維持状態 (自動算出) */
export interface PieceView extends Piece {
  maintenance: 'ok' | 'today' | 'review' | null;
  overdue_days: number;
}

export interface Session {
  id: number;
  piece_id: number;
  played_on: string;
  rating: Rating;
  note: string;
}

export interface Settings {
  daily_limit: number;
  mult_excellent: number;
  mult_good: number;
  mult_shaky: number;
  base_interval_days: number;
  max_interval_days: number;
  ease_min: number;
  ease_max: number;
  morning_hour: number;
  night_hour: number;
  night_enabled: boolean;
  monthly_prompt_enabled: boolean;
  reviving_warn_threshold: number;
}

export interface AppState {
  today: string;
  settings: Settings;
  pieces: PieceView[];
  today_piece_ids: number[];
  push_enabled: boolean;
}
