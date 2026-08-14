import { useEffect, useState } from 'react';
import type { Rating, Session, Status } from '../../shared/types';
import { RATING_LABEL, STATUS_LABEL } from '../../shared/types';
import type { PageProps } from '../App';
import { api } from '../api';
import RatingChart from '../RatingChart';
import { MaintenanceBadge, RatingButtons, dueLabel, formatDate } from '../ui';

export default function PieceDetail({
  state,
  refresh,
  notify,
  navigate,
  pieceId,
}: PageProps & { pieceId: number }) {
  const piece = state.pieces.find((p) => p.id === pieceId);
  const [draft, setDraft] = useState({ title: '', composer: '', notes: '', performed: '' });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!piece) return;
    setDraft({
      title: piece.title,
      composer: piece.composer,
      notes: piece.notes,
      performed: piece.last_performed_on ?? '',
    });
  }, [piece?.id]);

  useEffect(() => {
    api
      .sessions(pieceId)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [pieceId, state.pieces]);

  if (!piece) {
    return <p className="empty">曲が見つかりません。</p>;
  }

  const run = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
      if (message) notify({ message });
    } catch (err) {
      setError(err instanceof Error ? err.message : '失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const saveText = () =>
    run(
      () =>
        api.updatePiece(piece.id, {
          title: draft.title,
          composer: draft.composer,
          notes: draft.notes,
          last_performed_on: draft.performed || null,
        }),
      '保存しました',
    );

  const dirty =
    draft.title !== piece.title ||
    draft.composer !== piece.composer ||
    draft.notes !== piece.notes ||
    draft.performed !== (piece.last_performed_on ?? '');

  const changeStatus = (status: Status) =>
    run(() => api.updatePiece(piece.id, { status }), `${STATUS_LABEL[status]} にしました`);

  return (
    <>
      <div className="card">
        <div className="row between">
          <div className="grow">
            <span className="badge">{STATUS_LABEL[piece.status]}</span>{' '}
            {piece.memorized && <span className="badge">暗譜</span>}
          </div>
          <MaintenanceBadge piece={piece} />
        </div>
        {piece.status === 'active' && (
          <p className="meta" style={{ marginTop: 8 }}>
            次回 {formatDate(piece.next_due)}（{dueLabel(piece)}） · 現在の間隔{' '}
            {Math.round(piece.interval_days)}日 · 最終 {formatDate(piece.last_played_on)}
          </p>
        )}
      </div>

      <h2>曲の情報</h2>
      <div className="card">
        <label htmlFor="d-title">曲名</label>
        <input
          id="d-title"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <label htmlFor="d-composer">作曲者</label>
        <input
          id="d-composer"
          value={draft.composer}
          onChange={(e) => setDraft({ ...draft, composer: e.target.value })}
        />
        <label htmlFor="d-notes">メモ</label>
        <textarea
          id="d-notes"
          placeholder="次に弾くときの自分への申し送り"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
        <label htmlFor="d-performed">最後に人前で弾いた日</label>
        <input
          id="d-performed"
          type="date"
          value={draft.performed}
          onChange={(e) => setDraft({ ...draft, performed: e.target.value })}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary grow" type="button" disabled={!dirty || busy} onClick={saveText}>
            保存
          </button>
          <button
            className="ghost"
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () => api.updatePiece(piece.id, { memorized: !piece.memorized }),
                piece.memorized ? '暗譜ラベルを外しました' : '暗譜ラベルを付けました',
              )
            }
          >
            {piece.memorized ? '暗譜を外す' : '暗譜にする'}
          </button>
        </div>
      </div>

      <h2>状態</h2>
      <div className="card">
        {piece.status === 'active' ? (
          <>
            <p className="meta">
              維持スケジュールに乗っています。崩れてきたら復活中や休眠へ戻せます。
            </p>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="grow"
                type="button"
                disabled={busy}
                onClick={() => changeStatus('reviving')}
              >
                復活中に戻す
              </button>
              <button
                className="grow"
                type="button"
                disabled={busy}
                onClick={() => changeStatus('dormant')}
              >
                休眠に戻す
              </button>
            </div>
            <label htmlFor="d-due">次回予定日を手で変える</label>
            <input
              id="d-due"
              type="date"
              value={piece.next_due ?? ''}
              onChange={(e) =>
                run(() => api.updatePiece(piece.id, { next_due: e.target.value }), '予定日を変更しました')
              }
            />
          </>
        ) : (
          <>
            <p className="meta">
              {piece.status === 'dormant'
                ? '休眠中。復活させるときは「復活中」にしてから取り組みます。'
                : '復活中。弾けるようになったら「人前で弾ける」へ上げます。'}
            </p>
            <div className="row" style={{ marginTop: 10 }}>
              {piece.status === 'dormant' ? (
                <button
                  className="grow"
                  type="button"
                  disabled={busy}
                  onClick={() => changeStatus('reviving')}
                >
                  復活中にする
                </button>
              ) : (
                <button
                  className="grow"
                  type="button"
                  disabled={busy}
                  onClick={() => changeStatus('dormant')}
                >
                  休眠に戻す
                </button>
              )}
              <button
                className="primary grow"
                type="button"
                disabled={busy}
                onClick={() => setPromoting(!promoting)}
              >
                {promoting ? 'やめる' : '人前で弾けるへ'}
              </button>
            </div>
            {promoting && (
              <>
                <p className="meta" style={{ marginTop: 10 }}>
                  いま、この曲はどれくらい弾ける状態ですか？ここから維持スケジュールが始まります。
                </p>
                <RatingButtons
                  disabled={busy}
                  onPick={(rating: Rating) =>
                    run(async () => {
                      await api.promote(piece.id, rating);
                      setPromoting(false);
                    }, '維持スケジュールに乗せました')
                  }
                />
              </>
            )}
          </>
        )}
      </div>

      <h2>評価の履歴</h2>
      <div className="card">
        <RatingChart sessions={sessions} />
        {sessions.length > 0 && (
          <div className="scroll-x" style={{ marginTop: 12 }}>
            <table className="history-table">
              <thead>
                <tr>
                  <th>日付</th>
                  <th>評価</th>
                  <th>メモ</th>
                </tr>
              </thead>
              <tbody>
                {[...sessions].reverse().map((s) => (
                  <tr key={s.id}>
                    <td>{s.played_on}</td>
                    <td>{RATING_LABEL[s.rating]}</td>
                    <td style={{ whiteSpace: 'normal' }}>{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h2>削除</h2>
      <div className="card">
        <button
          className="danger"
          type="button"
          disabled={busy}
          style={{ width: '100%' }}
          onClick={() => {
            if (!confirm(`「${piece.title}」を記録ごと削除します。よろしいですか？`)) return;
            void run(async () => {
              await api.deletePiece(piece.id);
              navigate('/pieces');
            }, '削除しました');
          }}
        >
          この曲を削除する
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </>
  );
}
