import { useState } from 'react';
import type { PieceView, Rating } from '../../shared/types';
import { RATING_LABEL } from '../../shared/types';
import type { PageProps } from '../App';
import { api } from '../api';
import { MaintenanceBadge, RatingButtons, dueLabel, pieceName } from '../ui';

export default function Home({ state, refresh, notify }: PageProps) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [promotingId, setPromotingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const byId = new Map(state.pieces.map((p) => [p.id, p]));
  const today = state.today_piece_ids
    .map((id) => byId.get(id))
    .filter((p): p is PieceView => Boolean(p));
  const reviving = state.pieces.filter((p) => p.status === 'reviving');
  const dueTotal = state.pieces.filter(
    (p) => p.status === 'active' && p.next_due !== null && p.overdue_days >= 0,
  ).length;
  const carriedOver = Math.max(0, dueTotal - today.length);

  const record = async (piece: PieceView, rating: Rating) => {
    setBusyId(piece.id);
    setError('');
    try {
      await api.record(piece.id, rating);
      await refresh();
      notify({
        message: `${pieceName(piece)} を ${RATING_LABEL[rating]} で記録`,
        actionLabel: '取り消し',
        onAction: async () => {
          await api.undoRecord(piece.id);
          await refresh();
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '記録に失敗しました');
    } finally {
      setBusyId(null);
    }
  };

  const promote = async (piece: PieceView, rating: Rating) => {
    setBusyId(piece.id);
    setError('');
    try {
      await api.promote(piece.id, rating);
      setPromotingId(null);
      await refresh();
      notify({ message: `${pieceName(piece)} を「人前で弾ける」にしました` });
    } catch (err) {
      setError(err instanceof Error ? err.message : '昇格に失敗しました');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {reviving.length > state.settings.reviving_warn_threshold && (
        <p className="notice">
          復活中の曲が {reviving.length} 曲あります。同時に進めるのは
          {state.settings.reviving_warn_threshold} 曲までにすると、どれも進まない状態を避けられます。
        </p>
      )}

      {reviving.length > 0 && (
        <>
          <h2>復活中</h2>
          {reviving.map((piece) => (
            <div className="card" key={piece.id}>
              <div className="row between">
                <a className="grow" href={`#/piece/${piece.id}`} style={{ textDecoration: 'none' }}>
                  <div className="title">{piece.title}</div>
                  {piece.composer && <div className="composer">{piece.composer}</div>}
                </a>
                <button
                  className="small"
                  type="button"
                  onClick={() => setPromotingId(promotingId === piece.id ? null : piece.id)}
                >
                  {promotingId === piece.id ? 'やめる' : '弾けるようになった'}
                </button>
              </div>
              {promotingId === piece.id && (
                <>
                  <p className="meta" style={{ marginTop: 10 }}>
                    いま、この曲はどれくらい弾ける状態ですか？
                  </p>
                  <RatingButtons
                    disabled={busyId === piece.id}
                    onPick={(rating) => promote(piece, rating)}
                  />
                </>
              )}
            </div>
          ))}
        </>
      )}

      <h2>今日の維持練習</h2>
      {today.length === 0 ? (
        <p className="empty">今日は維持練習なし。好きな曲を自由にどうぞ。</p>
      ) : (
        today.map((piece) => (
          <div className={`card${piece.maintenance === 'review' ? ' review' : ''}`} key={piece.id}>
            <div className="row between">
              <a className="grow" href={`#/piece/${piece.id}`} style={{ textDecoration: 'none' }}>
                <div className="title">{piece.title}</div>
                {piece.composer && <div className="composer">{piece.composer}</div>}
              </a>
              <div className="row" style={{ gap: 6 }}>
                <MaintenanceBadge piece={piece} />
                <span className="badge">{dueLabel(piece)}</span>
              </div>
            </div>
            <RatingButtons disabled={busyId === piece.id} onPick={(r) => record(piece, r)} />
          </div>
        ))
      )}

      {carriedOver > 0 && (
        <p className="meta" style={{ marginTop: 12 }}>
          上限（1日{state.settings.daily_limit}曲）を超えた {carriedOver} 曲は翌日以降に繰り越されます。
        </p>
      )}

      {error && <p className="error">{error}</p>}
    </>
  );
}
