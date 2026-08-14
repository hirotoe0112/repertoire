import { useEffect, useState } from 'react';
import type { Settings } from '../../shared/types';
import type { PageProps } from '../App';
import { api, setToken } from '../api';
import { detectDelimiter, guessColumns, parseTable } from '../csv';

function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padded = base64.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return buffer;
}

function NumberField({
  label,
  value,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  step?: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <>
      <label>{label}</label>
      <input
        type="number"
        step={step ?? 1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          if (Number.isFinite(n) && n !== value) onCommit(n);
          else setText(String(value));
        }}
      />
    </>
  );
}

export default function SettingsPage({
  state,
  refresh,
  notify,
  onLogout,
}: PageProps & { onLogout: () => void }) {
  const s = state.settings;
  const [error, setError] = useState('');

  const save = async (patch: Partial<Settings>) => {
    setError('');
    try {
      await api.saveSettings(patch);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    }
  };

  return (
    <>
      <NotificationSection state={state} refresh={refresh} notify={notify} save={save} />

      <h2>練習量</h2>
      <div className="card">
        <NumberField
          label="1日に出す維持練習の上限（曲数）"
          value={s.daily_limit}
          onCommit={(v) => save({ daily_limit: v })}
        />
        <NumberField
          label="復活中が何曲を超えたら警告するか"
          value={s.reviving_warn_threshold}
          onCommit={(v) => save({ reviving_warn_threshold: v })}
        />
      </div>

      <h2>間隔の伸び方</h2>
      <div className="card">
        <p className="meta">
          次の間隔 = 現在の間隔 × 倍率 × 忘れやすさ係数。× は必ず1日に戻ります。
        </p>
        <NumberField
          label="◎ の倍率"
          value={s.mult_excellent}
          step={0.1}
          onCommit={(v) => save({ mult_excellent: v })}
        />
        <NumberField
          label="○ の倍率"
          value={s.mult_good}
          step={0.1}
          onCommit={(v) => save({ mult_good: v })}
        />
        <NumberField
          label="△ の倍率"
          value={s.mult_shaky}
          step={0.1}
          onCommit={(v) => save({ mult_shaky: v })}
        />
        <NumberField
          label="昇格時の基準間隔（日）"
          value={s.base_interval_days}
          onCommit={(v) => save({ base_interval_days: v })}
        />
        <NumberField
          label="間隔の上限（日）"
          value={s.max_interval_days}
          onCommit={(v) => save({ max_interval_days: v })}
        />
      </div>

      <ImportSection refresh={refresh} notify={notify} />

      <h2>バックアップ</h2>
      <div className="card">
        <p className="meta">全データを JSON ファイルとして書き出します。</p>
        <button
          type="button"
          style={{ width: '100%', marginTop: 10 }}
          onClick={async () => {
            const data = await api.exportAll();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `repertoire-${state.today}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          JSON で書き出す
        </button>
      </div>

      <PasswordSection notify={notify} />

      <h2>この端末</h2>
      <div className="card">
        <button type="button" className="danger" style={{ width: '100%' }} onClick={onLogout}>
          この端末からログアウト
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </>
  );
}

// ---------------------------------------------------------------- 通知

function NotificationSection({
  state,
  refresh,
  notify,
  save,
}: {
  state: PageProps['state'];
  refresh: PageProps['refresh'];
  notify: PageProps['notify'];
  save: (patch: Partial<Settings>) => Promise<void>;
}) {
  const s = state.settings;
  const [supported] = useState(
    () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  );
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => setSubscribed(false));
  }, [supported]);

  const enable = async () => {
    setBusy(true);
    setError('');
    try {
      const { publicKey } = await api.pushKey();
      if (!publicKey) throw new Error('サーバに VAPID 鍵が設定されていません');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('通知が許可されませんでした');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(publicKey),
      });
      await api.subscribePush(sub.toJSON());
      setSubscribed(true);
      await refresh();
      notify({ message: 'この端末で通知を受け取ります' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '通知を有効にできませんでした');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>通知</h2>
      <div className="card">
        {!supported ? (
          <p className="meta">この端末（ブラウザ）はプッシュ通知に対応していません。</p>
        ) : (
          <>
            <div className="row between">
              <span>{subscribed ? 'この端末で受け取ります' : 'この端末では受け取りません'}</span>
              <button
                type="button"
                className={subscribed ? 'ghost small' : 'primary small'}
                disabled={busy}
                onClick={subscribed ? disable : enable}
              >
                {subscribed ? '止める' : '有効にする'}
              </button>
            </div>
            <p className="meta" style={{ marginTop: 8 }}>
              Android では、Chrome で「ホーム画面に追加」してから有効にすると確実に届きます。
            </p>
            {subscribed && (
              <button
                type="button"
                className="small"
                style={{ marginTop: 10 }}
                onClick={async () => {
                  const { sent } = await api.testPush();
                  notify({ message: `テスト通知を ${sent} 件送りました` });
                }}
              >
                テスト送信
              </button>
            )}
            {error && <p className="error">{error}</p>}
          </>
        )}

        <NumberField
          label="朝の予告を送る時刻（JST・0〜23）"
          value={s.morning_hour}
          onCommit={(v) => save({ morning_hour: Math.min(23, Math.max(0, Math.round(v))) })}
        />
        <label>
          <input
            type="checkbox"
            style={{ width: 'auto', minHeight: 0, marginRight: 8 }}
            checked={s.night_enabled}
            onChange={(e) => save({ night_enabled: e.target.checked })}
          />
          夜に「まだ記録がありません」を送る
        </label>
        {s.night_enabled && (
          <NumberField
            label="夜のリマインドの時刻（JST・0〜23）"
            value={s.night_hour}
            onCommit={(v) => save({ night_hour: Math.min(23, Math.max(0, Math.round(v))) })}
          />
        )}
        <label>
          <input
            type="checkbox"
            style={{ width: 'auto', minHeight: 0, marginRight: 8 }}
            checked={s.monthly_prompt_enabled}
            onChange={(e) => save({ monthly_prompt_enabled: e.target.checked })}
          />
          月1回「新しくレパートリー入りした曲はありませんか？」を添える
        </label>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 取り込み

function ImportSection({
  refresh,
  notify,
}: {
  refresh: PageProps['refresh'];
  notify: PageProps['notify'];
}) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [titleCol, setTitleCol] = useState(0);
  const [composerCol, setComposerCol] = useState(-1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const analyze = () => {
    setError('');
    const parsed = parseTable(text, detectDelimiter(text));
    if (parsed.length === 0) {
      setError('読み取れる行がありませんでした');
      return;
    }
    setRows(parsed);
    const header = parsed[0];
    const looksLikeHeader = header.some((h) => /曲|title|name|作曲|composer/i.test(h));
    setHasHeader(looksLikeHeader && parsed.length > 1);
    const guess = guessColumns(header);
    setTitleCol(guess.title);
    setComposerCol(guess.composer);
  };

  const header = rows?.[0] ?? [];
  const body = rows ? (hasHeader ? rows.slice(1) : rows) : [];
  const items = body
    .map((r) => ({
      title: (r[titleCol] ?? '').trim(),
      composer: composerCol >= 0 ? (r[composerCol] ?? '').trim() : '',
    }))
    .filter((item) => item.title.length > 0);

  const columnOptions = header.map((h, i) => (
    <option key={i} value={i}>
      {hasHeader ? h || `列${i + 1}` : `列${i + 1}: ${h}`}
    </option>
  ));

  return (
    <>
      <h2>過去の曲を取り込む</h2>
      <div className="card">
        <p className="meta">
          Notion などで書き出した CSV を貼り付けるか、1行1曲で直接書きます。
          取り込んだ曲はすべて「休眠」になり、スケジュールには乗りません。
        </p>
        <textarea
          placeholder={'ショパン,バラード第1番\nベートーヴェン,悲愴 第2楽章'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setRows(null);
          }}
          style={{ marginTop: 10 }}
        />
        {!rows ? (
          <button
            type="button"
            className="primary"
            style={{ width: '100%', marginTop: 10 }}
            disabled={!text.trim()}
            onClick={analyze}
          >
            読み取る
          </button>
        ) : (
          <>
            {header.length > 1 && (
              <>
                <label>
                  <input
                    type="checkbox"
                    style={{ width: 'auto', minHeight: 0, marginRight: 8 }}
                    checked={hasHeader}
                    onChange={(e) => setHasHeader(e.target.checked)}
                  />
                  1行目は見出し
                </label>
                <label htmlFor="col-title">曲名の列</label>
                <select
                  id="col-title"
                  value={titleCol}
                  onChange={(e) => setTitleCol(Number(e.target.value))}
                >
                  {columnOptions}
                </select>
                <label htmlFor="col-composer">作曲者の列</label>
                <select
                  id="col-composer"
                  value={composerCol}
                  onChange={(e) => setComposerCol(Number(e.target.value))}
                >
                  <option value={-1}>使わない</option>
                  {columnOptions}
                </select>
              </>
            )}
            <p className="meta" style={{ marginTop: 10 }}>
              {items.length} 曲を取り込みます
              {items[0] && `（例: ${[items[0].composer, items[0].title].filter(Boolean).join(' ')}）`}
            </p>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="primary grow"
                disabled={busy || items.length === 0}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const res = await api.import(items);
                    setText('');
                    setRows(null);
                    await refresh();
                    notify({
                      message: `${res.added} 曲を追加${res.skipped ? `（${res.skipped} 曲は重複などで除外）` : ''}`,
                    });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : '取り込みに失敗しました');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                取り込む
              </button>
              <button type="button" className="ghost" onClick={() => setRows(null)}>
                やめる
              </button>
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 合言葉

function PasswordSection({ notify }: { notify: PageProps['notify'] }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');

  return (
    <>
      <h2>合言葉</h2>
      <div className="card">
        <label htmlFor="pw-current">現在の合言葉</label>
        <input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <label htmlFor="pw-next">新しい合言葉</label>
        <input
          id="pw-next"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <button
          type="button"
          style={{ width: '100%', marginTop: 12 }}
          disabled={!current || !next}
          onClick={async () => {
            setError('');
            try {
              const res = await api.changePassword(current, next);
              setToken(res.token);
              setCurrent('');
              setNext('');
              notify({ message: '合言葉を変更しました（他の端末は再入力が必要です）' });
            } catch (err) {
              setError(err instanceof Error ? err.message : '変更に失敗しました');
            }
          }}
        >
          変更する
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </>
  );
}
