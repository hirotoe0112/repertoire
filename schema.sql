-- ピアノ・レパートリー維持アプリ スキーマ (Cloudflare D1 / SQLite)
-- 日付はすべて JST の 'YYYY-MM-DD' 文字列、日時は ISO8601 UTC 文字列。

CREATE TABLE IF NOT EXISTS pieces (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  composer          TEXT    NOT NULL DEFAULT '',
  title             TEXT    NOT NULL,
  -- active = 人前で弾ける / reviving = 復活中 / dormant = 休眠
  status            TEXT    NOT NULL DEFAULT 'dormant',
  -- 暗譜ラベル。表示のみで、アルゴリズムには一切影響しない (設計 Q21)
  memorized         INTEGER NOT NULL DEFAULT 0,
  interval_days     REAL    NOT NULL DEFAULT 3,
  ease              REAL    NOT NULL DEFAULT 1.0,
  -- status = 'active' のときのみ値を持つ
  next_due          TEXT,
  last_played_on    TEXT,
  last_rating       TEXT,
  -- 最後に人前で弾いた日。記録のみで計算には使わない
  last_performed_on TEXT,
  notes             TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pieces_status   ON pieces(status);
CREATE INDEX IF NOT EXISTS idx_pieces_next_due ON pieces(next_due);

CREATE TABLE IF NOT EXISTS sessions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id            INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  played_on           TEXT    NOT NULL,
  -- excellent = ◎ / good = ○ / shaky = △ / lost = ×
  rating              TEXT    NOT NULL,
  note                TEXT    NOT NULL DEFAULT '',
  -- 取り消し(undo)のために、この記録を付ける直前の曲の状態を保持する
  prev_status         TEXT,
  prev_interval_days  REAL,
  prev_ease           REAL,
  prev_next_due       TEXT,
  prev_last_played_on TEXT,
  prev_last_rating    TEXT,
  created_at          TEXT    NOT NULL,
  -- 同じ曲は 1 日 1 記録。押し直しは上書き (設計 9)
  UNIQUE(piece_id, played_on)
);

CREATE INDEX IF NOT EXISTS idx_sessions_piece ON sessions(piece_id, played_on DESC);

CREATE TABLE IF NOT EXISTS settings (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  daily_limit             INTEGER NOT NULL DEFAULT 5,
  mult_excellent          REAL    NOT NULL DEFAULT 2.5,
  mult_good               REAL    NOT NULL DEFAULT 1.7,
  mult_shaky              REAL    NOT NULL DEFAULT 0.5,
  base_interval_days      REAL    NOT NULL DEFAULT 3,
  max_interval_days       INTEGER NOT NULL DEFAULT 180,
  ease_min                REAL    NOT NULL DEFAULT 0.5,
  ease_max                REAL    NOT NULL DEFAULT 2.0,
  morning_hour            INTEGER NOT NULL DEFAULT 8,
  night_hour              INTEGER NOT NULL DEFAULT 21,
  night_enabled           INTEGER NOT NULL DEFAULT 1,
  monthly_prompt_enabled  INTEGER NOT NULL DEFAULT 1,
  reviving_warn_threshold INTEGER NOT NULL DEFAULT 3,
  password_hash           TEXT,
  updated_at              TEXT    NOT NULL
);

INSERT OR IGNORE INTO settings (id, updated_at) VALUES (1, datetime('now'));

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint   TEXT    NOT NULL UNIQUE,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  label      TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);

-- 通知の重複送信を防ぐための送信ログ (kind = 'morning' | 'night' | 'monthly')
CREATE TABLE IF NOT EXISTS notification_log (
  sent_on    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (sent_on, kind)
);
