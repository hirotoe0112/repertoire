import type { AppState, PieceView, Rating, Session, Settings, Status } from '../shared/types';

const TOKEN_KEY = 'repertoire.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/login')) clearToken();
    throw new ApiError(data?.error ?? `通信に失敗しました (${res.status})`, res.status);
  }
  return data as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  status: () => request<{ configured: boolean }>('/status'),
  setup: (password: string) => post<{ token: string }>('/setup', { password }),
  login: (password: string) => post<{ token: string }>('/login', { password }),
  changePassword: (current: string, next: string) =>
    post<{ token: string }>('/password', { current, next }),

  state: () => request<AppState>('/state'),

  createPiece: (piece: Partial<PieceView>) => post<PieceView>('/pieces', piece),
  updatePiece: (id: number, patch: Partial<PieceView> & { status?: Status }) =>
    request<PieceView>(`/pieces/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deletePiece: (id: number) => request<{ ok: true }>(`/pieces/${id}`, { method: 'DELETE' }),

  record: (id: number, rating: Rating, note?: string) =>
    post<PieceView>(`/pieces/${id}/record`, { rating, note }),
  undoRecord: (id: number) => request<PieceView>(`/pieces/${id}/record`, { method: 'DELETE' }),
  promote: (id: number, rating: Rating) => post<PieceView>(`/pieces/${id}/promote`, { rating }),
  sessions: (id: number) => request<Session[]>(`/pieces/${id}/sessions`),

  import: (items: { composer: string; title: string }[]) =>
    post<{ added: number; skipped: number }>('/import', { items }),
  exportAll: () => request<unknown>('/export'),

  saveSettings: (patch: Partial<Settings>) =>
    request<Settings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  pushKey: () => request<{ publicKey: string | null }>('/push/key'),
  subscribePush: (sub: PushSubscriptionJSON) =>
    post<{ ok: true }>('/push/subscribe', {
      endpoint: sub.endpoint,
      keys: sub.keys,
    }),
  unsubscribePush: (endpoint: string) => post<{ ok: true }>('/push/unsubscribe', { endpoint }),
  testPush: () => post<{ sent: number }>('/push/test'),
};
