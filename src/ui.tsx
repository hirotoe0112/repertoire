import type { PieceView, Rating } from '../shared/types';
import { RATING_DESC, RATING_LABEL } from '../shared/types';

export const RATINGS: Rating[] = ['excellent', 'good', 'shaky', 'lost'];

export function RatingButtons({
  onPick,
  disabled,
}: {
  onPick: (rating: Rating) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ratings">
      {RATINGS.map((rating) => (
        <button
          key={rating}
          type="button"
          disabled={disabled}
          onClick={() => onPick(rating)}
          aria-label={`${RATING_LABEL[rating]} ${RATING_DESC[rating]}`}
        >
          {RATING_LABEL[rating]}
          <small>{RATING_DESC[rating]}</small>
        </button>
      ))}
    </div>
  );
}

/** 維持状態のバッジ (自動算出) */
export function MaintenanceBadge({ piece }: { piece: PieceView }) {
  if (piece.status !== 'active' || !piece.maintenance) return null;
  if (piece.maintenance === 'review') return <span className="badge review">要復習</span>;
  if (piece.maintenance === 'today') return <span className="badge today">今日やる</span>;
  return <span className="badge ok">良好</span>;
}

/** 次回予定日を「◯日超過 / あと◯日」の形にする */
export function dueLabel(piece: PieceView): string {
  if (piece.status !== 'active' || !piece.next_due) return '';
  const d = piece.overdue_days;
  if (d > 0) return `${d}日超過`;
  if (d === 0) return '今日';
  return `あと${-d}日`;
}

export function formatDate(date: string | null): string {
  if (!date) return '—';
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function pieceName(piece: { composer: string; title: string }): string {
  return [piece.composer, piece.title].filter(Boolean).join(' ');
}
