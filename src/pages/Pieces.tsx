import { useMemo, useState } from 'react';
import type { Status } from '../../shared/types';
import { STATUS_LABEL } from '../../shared/types';
import type { PageProps } from '../App';
import { api } from '../api';
import { MaintenanceBadge, dueLabel, formatDate } from '../ui';

type Filter = 'all' | Status;
type Sort = 'due' | 'played' | 'title';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'active', label: STATUS_LABEL.active },
  { key: 'reviving', label: STATUS_LABEL.reviving },
  { key: 'dormant', label: STATUS_LABEL.dormant },
];

export default function Pieces({ state, refresh, notify }: PageProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('due');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ composer: '', title: '', status: 'dormant' as Status });
  const [error, setError] = useState('');

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: state.pieces.length };
    for (const p of state.pieces) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [state.pieces]);

  const pieces = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = state.pieces.filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false;
      if (!q) return true;
      return `${p.composer} ${p.title}`.toLowerCase().includes(q);
    });
    return list.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'ja');
      if (sort === 'played') return (b.last_played_on ?? '').localeCompare(a.last_played_on ?? '');
      // 次回予定日: 予定の近い順。予定を持たない曲 (休眠・復活中) は後ろへ
      if (!a.next_due && !b.next_due) return a.title.localeCompare(b.title, 'ja');
      if (!a.next_due) return 1;
      if (!b.next_due) return -1;
      return a.next_due.localeCompare(b.next_due);
    });
  }, [state.pieces, filter, sort, query]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const created = await api.createPiece(draft);
      setDraft({ composer: '', title: '', status: 'dormant' });
      setAdding(false);
      await refresh();
      notify({ message: `${created.title} を追加しました` });
    } catch (err) {
      setError(err instanceof Error ? err.message : '追加に失敗しました');
    }
  };

  return (
    <>
      <div className="chips">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip${filter === f.key ? ' active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label} {counts[f.key] ?? 0}
          </button>
        ))}
      </div>

      <div className="list-controls">
        <input
          className="grow"
          type="search"
          placeholder="曲名・作曲者で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: 150 }}>
          <option value="due">次回予定日順</option>
          <option value="played">最終演奏日順</option>
          <option value="title">曲名順</option>
        </select>
      </div>

      {adding ? (
        <form className="card" onSubmit={add}>
          <label htmlFor="new-title">曲名</label>
          <input
            id="new-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            autoFocus
          />
          <label htmlFor="new-composer">作曲者（任意）</label>
          <input
            id="new-composer"
            value={draft.composer}
            onChange={(e) => setDraft({ ...draft, composer: e.target.value })}
          />
          <label htmlFor="new-status">状態</label>
          <select
            id="new-status"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}
          >
            <option value="dormant">{STATUS_LABEL.dormant}</option>
            <option value="reviving">{STATUS_LABEL.reviving}</option>
          </select>
          <p className="meta" style={{ marginTop: 8 }}>
            「人前で弾ける」へは、詳細画面から手応えの評価とセットで上げます。
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary grow" type="submit">
              追加
            </button>
            <button className="ghost" type="button" onClick={() => setAdding(false)}>
              やめる
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      ) : (
        <button className="primary" type="button" onClick={() => setAdding(true)} style={{ width: '100%', marginBottom: 12 }}>
          曲を追加
        </button>
      )}

      {pieces.length === 0 ? (
        <p className="empty">該当する曲がありません。</p>
      ) : (
        pieces.map((piece) => (
          <a
            key={piece.id}
            href={`#/piece/${piece.id}`}
            className={`card${piece.maintenance === 'review' ? ' review' : ''}`}
            style={{ display: 'block', textDecoration: 'none' }}
          >
            <div className="row between">
              <div className="grow">
                <div className="title">{piece.title}</div>
                {piece.composer && <div className="composer">{piece.composer}</div>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                {piece.memorized && <span className="badge">暗譜</span>}
                {piece.status === 'active' ? (
                  <MaintenanceBadge piece={piece} />
                ) : (
                  <span className="badge">{STATUS_LABEL[piece.status]}</span>
                )}
              </div>
            </div>
            <div className="meta">
              {piece.status === 'active' && `次回 ${formatDate(piece.next_due)}（${dueLabel(piece)}） · `}
              最終 {formatDate(piece.last_played_on)}
            </div>
          </a>
        ))
      )}
    </>
  );
}
