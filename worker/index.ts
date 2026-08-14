import { hashPassword, issueToken, verifyPassword, verifyToken } from './auth';
import { jstDate, jstDayOfMonth, jstHour, nowIso } from './dates';
import { sendPush, type PushMessage, type VapidKeys } from './push';
import { applyRating, maintenanceState, overdueDays, promote, todaysPractice } from './schedule';
import type { AppState, Piece, PieceView, Rating, Settings, Status } from '../shared/types';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

const RATINGS: Rating[] = ['excellent', 'good', 'shaky', 'lost'];
const STATUSES: Status[] = ['active', 'reviving', 'dormant'];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

// ---------------------------------------------------------------- 行の変換

interface SettingsRow extends Omit<Settings, 'night_enabled' | 'monthly_prompt_enabled'> {
  night_enabled: number;
  monthly_prompt_enabled: number;
  password_hash: string | null;
}

async function loadSettingsRow(env: Env): Promise<SettingsRow> {
  const row = await env.DB.prepare('SELECT * FROM settings WHERE id = 1').first<SettingsRow>();
  if (!row) throw new Error('settings 行がありません。schema.sql を適用してください');
  return row;
}

function toSettings(row: SettingsRow): Settings {
  return {
    daily_limit: row.daily_limit,
    mult_excellent: row.mult_excellent,
    mult_good: row.mult_good,
    mult_shaky: row.mult_shaky,
    base_interval_days: row.base_interval_days,
    max_interval_days: row.max_interval_days,
    ease_min: row.ease_min,
    ease_max: row.ease_max,
    morning_hour: row.morning_hour,
    night_hour: row.night_hour,
    night_enabled: !!row.night_enabled,
    monthly_prompt_enabled: !!row.monthly_prompt_enabled,
    reviving_warn_threshold: row.reviving_warn_threshold,
  };
}

function toPiece(row: Record<string, unknown>): Piece {
  return {
    id: row.id as number,
    composer: (row.composer as string) ?? '',
    title: row.title as string,
    status: row.status as Status,
    memorized: !!row.memorized,
    interval_days: row.interval_days as number,
    ease: row.ease as number,
    next_due: (row.next_due as string) ?? null,
    last_played_on: (row.last_played_on as string) ?? null,
    last_rating: (row.last_rating as Rating) ?? null,
    last_performed_on: (row.last_performed_on as string) ?? null,
    notes: (row.notes as string) ?? '',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function toView(piece: Piece, today: string): PieceView {
  return {
    ...piece,
    maintenance: maintenanceState(piece, today),
    overdue_days: overdueDays(piece, today),
  };
}

async function allPieces(env: Env): Promise<Piece[]> {
  const { results } = await env.DB.prepare('SELECT * FROM pieces ORDER BY id').all();
  return (results as Record<string, unknown>[]).map(toPiece);
}

async function getPiece(env: Env, id: number): Promise<Piece | null> {
  const row = await env.DB.prepare('SELECT * FROM pieces WHERE id = ?').bind(id).first();
  return row ? toPiece(row as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------- 通知

function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || 'mailto:repertoire@example.com',
  };
}

async function broadcast(env: Env, message: PushMessage): Promise<number> {
  const keys = vapidKeys(env);
  if (!keys) return 0;
  const { results } = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions',
  ).all<{ endpoint: string; p256dh: string; auth: string }>();
  let sent = 0;
  for (const sub of results ?? []) {
    try {
      const res = await sendPush(sub, message, keys);
      if (res.ok) sent++;
      if (res.expired) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
          .bind(sub.endpoint)
          .run();
      }
    } catch {
      // 1 件の失敗で他の端末への送信を止めない
    }
  }
  return sent;
}

function describeList(pieces: Piece[]): string {
  const first = pieces[0];
  const name = first ? [first.composer, first.title].filter(Boolean).join(' ') : '';
  return pieces.length === 1 ? `1曲（${name}）` : `${pieces.length}曲（${name} ほか）`;
}

/** 毎時起動し、JST の時刻が設定に一致したときだけ送る (時刻を設定画面から変えられるようにするため) */
async function runScheduled(env: Env): Promise<void> {
  const keys = vapidKeys(env);
  if (!keys) return;

  const settingsRow = await loadSettingsRow(env);
  const settings = toSettings(settingsRow);
  const today = jstDate();
  const hour = jstHour();

  const alreadySent = async (kind: string): Promise<boolean> => {
    const row = await env.DB.prepare(
      'SELECT 1 AS x FROM notification_log WHERE sent_on = ? AND kind = ?',
    )
      .bind(today, kind)
      .first();
    return !!row;
  };
  const markSent = (kind: string) =>
    env.DB.prepare(
      'INSERT OR IGNORE INTO notification_log (sent_on, kind, created_at) VALUES (?, ?, ?)',
    )
      .bind(today, kind, nowIso())
      .run();

  const pieces = await allPieces(env);
  const due = todaysPractice(pieces, today, settings.daily_limit);

  if (hour === settings.morning_hour && !(await alreadySent('morning'))) {
    const monthly = settings.monthly_prompt_enabled && jstDayOfMonth() === 1;
    const message: PushMessage =
      due.length > 0
        ? { title: '今日の維持練習', body: describeList(due), url: '/', tag: 'daily' }
        : {
            title: '今日は維持練習なし',
            body: '好きな曲を自由にどうぞ',
            url: '/',
            tag: 'daily',
          };
    if (monthly) {
      message.body += '\n新しくレパートリー入りした曲はありませんか？';
    }
    await broadcast(env, message);
    await markSent('morning');
  }

  if (
    settings.night_enabled &&
    hour === settings.night_hour &&
    due.length > 0 &&
    !(await alreadySent('night'))
  ) {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM sessions WHERE played_on = ?',
    )
      .bind(today)
      .first<{ n: number }>();
    if ((row?.n ?? 0) === 0) {
      await broadcast(env, {
        title: 'まだ記録がありません',
        body: describeList(due),
        url: '/',
        tag: 'daily',
      });
      await markSent('night');
    }
  }
}

// ---------------------------------------------------------------- API

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;
  const settingsRow = await loadSettingsRow(env);

  // --- 認証が不要な経路
  if (path === '/status' && method === 'GET') {
    return json({ configured: !!settingsRow.password_hash });
  }

  if (path === '/setup' && method === 'POST') {
    if (settingsRow.password_hash) return badRequest('すでに設定済みです');
    const { password } = (await request.json()) as { password?: string };
    if (!password || password.length < 4) return badRequest('4文字以上の合言葉を入れてください');
    const hash = await hashPassword(password);
    await env.DB.prepare('UPDATE settings SET password_hash = ?, updated_at = ? WHERE id = 1')
      .bind(hash, nowIso())
      .run();
    return json({ token: await issueToken(hash) });
  }

  if (path === '/login' && method === 'POST') {
    if (!settingsRow.password_hash) return badRequest('まだ合言葉が設定されていません');
    const { password } = (await request.json()) as { password?: string };
    if (!password || !(await verifyPassword(password, settingsRow.password_hash))) {
      return json({ error: '合言葉が違います' }, 401);
    }
    return json({ token: await issueToken(settingsRow.password_hash) });
  }

  // --- ここから先は認証必須
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!settingsRow.password_hash || !(await verifyToken(token, settingsRow.password_hash))) {
    return json({ error: 'unauthorized' }, 401);
  }

  const settings = toSettings(settingsRow);
  const today = jstDate();

  if (path === '/state' && method === 'GET') {
    const pieces = await allPieces(env);
    const due = todaysPractice(pieces, today, settings.daily_limit);
    const pushRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{
      n: number;
    }>();
    const state: AppState = {
      today,
      settings,
      pieces: pieces.map((p) => toView(p, today)),
      today_piece_ids: due.map((p) => p.id),
      push_enabled: (pushRow?.n ?? 0) > 0,
    };
    return json(state);
  }

  if (path === '/pieces' && method === 'POST') {
    const body = (await request.json()) as Partial<Piece>;
    if (!body.title?.trim()) return badRequest('曲名は必須です');
    const status: Status = STATUSES.includes(body.status as Status)
      ? (body.status as Status)
      : 'dormant';
    const now = nowIso();
    const res = await env.DB.prepare(
      `INSERT INTO pieces (composer, title, status, memorized, notes, interval_days, ease,
                           next_due, last_performed_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1.0, NULL, ?, ?, ?)`,
    )
      .bind(
        (body.composer ?? '').trim(),
        body.title.trim(),
        status,
        body.memorized ? 1 : 0,
        body.notes ?? '',
        settings.base_interval_days,
        body.last_performed_on ?? null,
        now,
        now,
      )
      .run();
    const piece = await getPiece(env, res.meta.last_row_id as number);
    return json(toView(piece!, today));
  }

  const pieceMatch = path.match(/^\/pieces\/(\d+)(\/[a-z]+)?$/);
  if (pieceMatch) {
    const id = Number(pieceMatch[1]);
    const sub = pieceMatch[2] ?? '';
    const piece = await getPiece(env, id);
    if (!piece) return json({ error: '曲が見つかりません' }, 404);

    if (sub === '' && method === 'PATCH') {
      const body = (await request.json()) as Partial<Piece>;
      const fields: string[] = [];
      const values: unknown[] = [];
      const set = (col: string, value: unknown) => {
        fields.push(`${col} = ?`);
        values.push(value);
      };
      if (body.composer !== undefined) set('composer', body.composer.trim());
      if (body.title !== undefined) {
        if (!body.title.trim()) return badRequest('曲名は必須です');
        set('title', body.title.trim());
      }
      if (body.memorized !== undefined) set('memorized', body.memorized ? 1 : 0);
      if (body.notes !== undefined) set('notes', body.notes);
      if (body.last_performed_on !== undefined) set('last_performed_on', body.last_performed_on);
      if (body.next_due !== undefined) set('next_due', body.next_due);
      if (body.interval_days !== undefined) set('interval_days', body.interval_days);
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return badRequest('不正な状態です');
        // active への昇格は /promote で評価とセットで行う (設計 Q35)
        if (body.status === 'active' && piece.status !== 'active') {
          return badRequest('「人前で弾ける」へ上げるときは手応えの評価が必要です');
        }
        set('status', body.status);
        if (body.status !== 'active') set('next_due', null);
      }
      if (fields.length === 0) return json(toView(piece, today));
      set('updated_at', nowIso());
      await env.DB.prepare(`UPDATE pieces SET ${fields.join(', ')} WHERE id = ?`)
        .bind(...values, id)
        .run();
      return json(toView((await getPiece(env, id))!, today));
    }

    if (sub === '' && method === 'DELETE') {
      await env.DB.prepare('DELETE FROM sessions WHERE piece_id = ?').bind(id).run();
      await env.DB.prepare('DELETE FROM pieces WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }

    if (sub === '/sessions' && method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, piece_id, played_on, rating, note FROM sessions WHERE piece_id = ? ORDER BY played_on',
      )
        .bind(id)
        .all();
      return json(results ?? []);
    }

    if (sub === '/promote' && method === 'POST') {
      const { rating } = (await request.json()) as { rating?: Rating };
      if (!rating || !RATINGS.includes(rating)) return badRequest('評価が不正です');
      if (piece.status === 'active') return badRequest('すでに「人前で弾ける」です');
      const next = promote(rating, today, settings);
      await env.DB.prepare(
        `UPDATE pieces SET status = 'active', interval_days = ?, ease = ?, next_due = ?,
                           last_played_on = ?, last_rating = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(next.interval_days, next.ease, next.next_due, today, rating, nowIso(), id)
        .run();
      await env.DB.prepare(
        `INSERT INTO sessions (piece_id, played_on, rating, note, prev_status, prev_interval_days,
                               prev_ease, prev_next_due, prev_last_played_on, prev_last_rating, created_at)
         VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(piece_id, played_on) DO UPDATE SET rating = excluded.rating`,
      )
        .bind(
          id,
          today,
          rating,
          piece.status,
          piece.interval_days,
          piece.ease,
          piece.next_due,
          piece.last_played_on,
          piece.last_rating,
          nowIso(),
        )
        .run();
      return json(toView((await getPiece(env, id))!, today));
    }

    if (sub === '/record' && method === 'POST') {
      const { rating, note } = (await request.json()) as { rating?: Rating; note?: string };
      if (!rating || !RATINGS.includes(rating)) return badRequest('評価が不正です');
      if (piece.status !== 'active') {
        return badRequest('記録できるのは「人前で弾ける」曲だけです');
      }
      // 同じ日に押し直したときは、その日の記録を付ける前の状態から計算し直す (1日1記録)
      const existing = await env.DB.prepare(
        'SELECT * FROM sessions WHERE piece_id = ? AND played_on = ?',
      )
        .bind(id, today)
        .first<Record<string, unknown>>();
      const base = existing
        ? {
            interval_days: existing.prev_interval_days as number,
            ease: existing.prev_ease as number,
          }
        : { interval_days: piece.interval_days, ease: piece.ease };
      const prev = existing
        ? {
            interval_days: existing.prev_interval_days as number,
            ease: existing.prev_ease as number,
            next_due: (existing.prev_next_due as string) ?? null,
            last_played_on: (existing.prev_last_played_on as string) ?? null,
            last_rating: (existing.prev_last_rating as Rating) ?? null,
          }
        : {
            interval_days: piece.interval_days,
            ease: piece.ease,
            next_due: piece.next_due,
            last_played_on: piece.last_played_on,
            last_rating: piece.last_rating,
          };

      const next = applyRating(base, rating, today, settings);
      await env.DB.prepare(
        `UPDATE pieces SET interval_days = ?, ease = ?, next_due = ?, last_played_on = ?,
                           last_rating = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(next.interval_days, next.ease, next.next_due, today, rating, nowIso(), id)
        .run();
      await env.DB.prepare(
        `INSERT INTO sessions (piece_id, played_on, rating, note, prev_status, prev_interval_days,
                               prev_ease, prev_next_due, prev_last_played_on, prev_last_rating, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(piece_id, played_on) DO UPDATE SET
           rating = excluded.rating,
           note = CASE WHEN excluded.note = '' THEN sessions.note ELSE excluded.note END`,
      )
        .bind(
          id,
          today,
          rating,
          note ?? '',
          piece.status,
          prev.interval_days,
          prev.ease,
          prev.next_due,
          prev.last_played_on,
          prev.last_rating,
          nowIso(),
        )
        .run();
      return json(toView((await getPiece(env, id))!, today));
    }

    // 誤タップの取り消し: 今日の記録を消して、直前の状態へ戻す
    if (sub === '/record' && method === 'DELETE') {
      const existing = await env.DB.prepare(
        'SELECT * FROM sessions WHERE piece_id = ? AND played_on = ?',
      )
        .bind(id, today)
        .first<Record<string, unknown>>();
      if (!existing) return badRequest('今日の記録がありません');
      // 昇格を取り消したときは状態も戻す。戻さないと「人前で弾ける」のまま
      // 次回予定日を持たない曲が生まれ、今日のリストから静かに消えてしまう。
      await env.DB.prepare(
        `UPDATE pieces SET status = ?, interval_days = ?, ease = ?, next_due = ?, last_played_on = ?,
                           last_rating = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(
          (existing.prev_status as string) ?? piece.status,
          existing.prev_interval_days,
          existing.prev_ease,
          existing.prev_next_due,
          existing.prev_last_played_on,
          existing.prev_last_rating,
          nowIso(),
          id,
        )
        .run();
      await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(existing.id).run();
      return json(toView((await getPiece(env, id))!, today));
    }
  }

  if (path === '/import' && method === 'POST') {
    const { items } = (await request.json()) as { items?: { composer?: string; title?: string }[] };
    if (!Array.isArray(items) || items.length === 0) return badRequest('取り込む行がありません');
    const now = nowIso();
    let added = 0;
    let skipped = 0;
    for (const item of items) {
      const title = (item.title ?? '').trim();
      if (!title) {
        skipped++;
        continue;
      }
      const composer = (item.composer ?? '').trim();
      const dup = await env.DB.prepare('SELECT 1 AS x FROM pieces WHERE title = ? AND composer = ?')
        .bind(title, composer)
        .first();
      if (dup) {
        skipped++;
        continue;
      }
      // 取り込みは全曲 休眠 として登録し、スケジュールには一切乗せない (設計 Q43)
      await env.DB.prepare(
        `INSERT INTO pieces (composer, title, status, interval_days, ease, created_at, updated_at)
         VALUES (?, ?, 'dormant', ?, 1.0, ?, ?)`,
      )
        .bind(composer, title, settings.base_interval_days, now, now)
        .run();
      added++;
    }
    return json({ added, skipped });
  }

  if (path === '/export' && method === 'GET') {
    const pieces = await env.DB.prepare('SELECT * FROM pieces ORDER BY id').all();
    const sessions = await env.DB.prepare('SELECT * FROM sessions ORDER BY id').all();
    return json({
      exported_at: nowIso(),
      settings,
      pieces: pieces.results ?? [],
      sessions: sessions.results ?? [],
    });
  }

  if (path === '/settings' && method === 'PUT') {
    const body = (await request.json()) as Partial<Settings>;
    const numeric: (keyof Settings)[] = [
      'daily_limit',
      'mult_excellent',
      'mult_good',
      'mult_shaky',
      'base_interval_days',
      'max_interval_days',
      'morning_hour',
      'night_hour',
      'reviving_warn_threshold',
    ];
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of numeric) {
      const value = body[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    for (const key of ['night_enabled', 'monthly_prompt_enabled'] as const) {
      if (typeof body[key] === 'boolean') {
        fields.push(`${key} = ?`);
        values.push(body[key] ? 1 : 0);
      }
    }
    if (fields.length > 0) {
      fields.push('updated_at = ?');
      values.push(nowIso());
      await env.DB.prepare(`UPDATE settings SET ${fields.join(', ')} WHERE id = 1`)
        .bind(...values)
        .run();
    }
    return json(toSettings(await loadSettingsRow(env)));
  }

  if (path === '/password' && method === 'POST') {
    const { current, next } = (await request.json()) as { current?: string; next?: string };
    if (!current || !(await verifyPassword(current, settingsRow.password_hash!))) {
      return badRequest('現在の合言葉が違います');
    }
    if (!next || next.length < 4) return badRequest('4文字以上の合言葉を入れてください');
    const hash = await hashPassword(next);
    await env.DB.prepare('UPDATE settings SET password_hash = ?, updated_at = ? WHERE id = 1')
      .bind(hash, nowIso())
      .run();
    return json({ token: await issueToken(hash) });
  }

  if (path === '/push/key' && method === 'GET') {
    return json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
  }

  if (path === '/push/subscribe' && method === 'POST') {
    const body = (await request.json()) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
      label?: string;
    };
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return badRequest('購読情報が不正です');
    }
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
    )
      .bind(body.endpoint, body.keys.p256dh, body.keys.auth, body.label ?? '', nowIso())
      .run();
    return json({ ok: true });
  }

  if (path === '/push/unsubscribe' && method === 'POST') {
    const { endpoint } = (await request.json()) as { endpoint?: string };
    if (endpoint) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
    }
    return json({ ok: true });
  }

  if (path === '/push/test' && method === 'POST') {
    if (!vapidKeys(env)) return badRequest('VAPID 鍵が未設定です');
    const sent = await broadcast(env, {
      title: 'テスト通知',
      body: '通知はここに届きます',
      url: '/',
      tag: 'test',
    });
    return json({ sent });
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env));
  },
};
