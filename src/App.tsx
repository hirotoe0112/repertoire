import { useCallback, useEffect, useState } from 'react';
import type { AppState } from '../shared/types';
import { api, clearToken, getToken, setToken } from './api';
import Home from './pages/Home';
import Pieces from './pages/Pieces';
import PieceDetail from './pages/PieceDetail';
import SettingsPage from './pages/Settings';

export interface ToastAction {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface PageProps {
  state: AppState;
  refresh: () => Promise<void>;
  notify: (toast: ToastAction) => void;
  navigate: (route: string) => void;
}

function useHashRoute(): [string, (route: string) => void] {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((next: string) => {
    window.location.hash = next;
  }, []);
  return [route, navigate];
}

function Gate({ onAuthed }: { onAuthed: () => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .status()
      .then((s) => setConfigured(s.configured))
      .catch(() => setError('サーバに接続できません'));
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (configured === false && password !== confirmPassword) {
      setError('確認用の合言葉が一致しません');
      return;
    }
    setBusy(true);
    try {
      const res = configured ? await api.login(password) : await api.setup(password);
      setToken(res.token);
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : '失敗しました');
    } finally {
      setBusy(false);
    }
  };

  if (configured === null) {
    return (
      <div className="center-screen">
        <p className="muted">{error || '読み込み中…'}</p>
      </div>
    );
  }

  return (
    <div className="center-screen">
      <h1>レパートリー維持</h1>
      <p className="muted">
        {configured ? '合言葉を入力してください。' : '最初に合言葉を決めてください。'}
      </p>
      <form onSubmit={submit}>
        <label htmlFor="pw">合言葉</label>
        <input
          id="pw"
          type="password"
          autoComplete={configured ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {!configured && (
          <>
            <label htmlFor="pw2">合言葉（確認）</label>
            <input
              id="pw2"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </>
        )}
        <button className="primary" type="submit" disabled={busy} style={{ marginTop: 16 }}>
          {configured ? '開く' : '設定して開く'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

function Toast({ toast, onClose }: { toast: ToastAction; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  return (
    <div className="toast" role="status">
      <span className="grow">{toast.message}</span>
      {toast.actionLabel && (
        <button
          className="small"
          type="button"
          onClick={() => {
            toast.onAction?.();
            onClose();
          }}
        >
          {toast.actionLabel}
        </button>
      )}
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<ToastAction | null>(null);
  const [route, navigate] = useHashRoute();

  const refresh = useCallback(async () => {
    try {
      setState(await api.state());
      setError('');
    } catch (err) {
      if (!getToken()) {
        setAuthed(false);
        return;
      }
      setError(err instanceof Error ? err.message : '読み込みに失敗しました');
    }
  }, []);

  useEffect(() => {
    if (authed) void refresh();
  }, [authed, refresh]);

  if (!authed) {
    return (
      <Gate
        onAuthed={() => {
          setAuthed(true);
        }}
      />
    );
  }

  if (!state) {
    return (
      <div className="center-screen">
        <p className="muted">{error || '読み込み中…'}</p>
      </div>
    );
  }

  const props: PageProps = { state, refresh, notify: setToast, navigate };
  const detailMatch = route.match(/^\/piece\/(\d+)$/);

  let page = <Home {...props} />;
  let heading = '今日の練習';
  if (route.startsWith('/pieces')) {
    page = <Pieces {...props} />;
    heading = '全曲一覧';
  } else if (detailMatch) {
    page = <PieceDetail {...props} pieceId={Number(detailMatch[1])} />;
    heading = '曲の詳細';
  } else if (route.startsWith('/settings')) {
    page = <SettingsPage {...props} onLogout={() => {
      clearToken();
      setAuthed(false);
    }} />;
    heading = '設定';
  }

  const tab = detailMatch ? '/pieces' : route.split('?')[0];

  return (
    <>
      <header className="app">
        <div className="inner">
          <h1>{heading}</h1>
          <span className="meta">{state.today}</span>
        </div>
      </header>
      <main>
        {error && <p className="error">{error}</p>}
        {page}
      </main>
      <nav className="tabs">
        <a href="#/" className={tab === '/' ? 'active' : ''}>
          今日
        </a>
        <a href="#/pieces" className={tab.startsWith('/pieces') ? 'active' : ''}>
          全曲
        </a>
        <a href="#/settings" className={tab.startsWith('/settings') ? 'active' : ''}>
          設定
        </a>
      </nav>
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </>
  );
}
