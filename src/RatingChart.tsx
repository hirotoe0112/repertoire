import type { Rating, Session } from '../shared/types';
import { RATING_LABEL } from '../shared/types';

// 評価は4段階の順序尺度。位置(縦軸)が意味を担い、色は状態の補助として乗せる。
const LEVEL: Record<Rating, number> = { lost: 1, shaky: 2, good: 3, excellent: 4 };
const LEVELS: Rating[] = ['excellent', 'good', 'shaky', 'lost'];

// status パレット (good / warning / serious / critical)
const COLOR: Record<Rating, string> = {
  excellent: '#0ca30c',
  good: '#fab219',
  shaky: '#ec835a',
  lost: '#d03b3b',
};

const W = 320;
const H = 128;
const PAD = { top: 10, right: 10, bottom: 22, left: 26 };

export default function RatingChart({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) {
    return <p className="empty">まだ記録がありません。</p>;
  }

  const times = sessions.map((s) => Date.parse(`${s.played_on}T00:00:00Z`));
  const minTime = times[0];
  const maxTime = times[times.length - 1];
  const span = Math.max(1, maxTime - minTime);

  const x = (t: number) =>
    sessions.length === 1
      ? (PAD.left + (W - PAD.right)) / 2
      : PAD.left + ((t - minTime) / span) * (W - PAD.left - PAD.right);
  const y = (level: number) =>
    H - PAD.bottom - ((level - 1) / 3) * (H - PAD.top - PAD.bottom);

  const points = sessions.map((s, i) => ({
    session: s,
    cx: x(times[i]),
    cy: y(LEVEL[s.rating]),
  }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="auto"
      role="img"
      aria-label="評価の履歴"
      style={{ display: 'block', maxWidth: '100%' }}
    >
      {LEVELS.map((rating) => {
        const gy = y(LEVEL[rating]);
        return (
          <g key={rating}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={gy}
              y2={gy}
              stroke="#3a3532"
              strokeWidth="1"
            />
            <text x={0} y={gy + 4} fill="#a8a29e" fontSize="11">
              {RATING_LABEL[rating]}
            </text>
          </g>
        );
      })}

      {points.length > 1 && (
        <path d={path} fill="none" stroke="#898781" strokeWidth="2" strokeLinejoin="round" />
      )}

      {points.map((p) => (
        <circle
          key={p.session.id}
          cx={p.cx}
          cy={p.cy}
          r="4.5"
          fill={COLOR[p.session.rating]}
          stroke="#292524"
          strokeWidth="2"
        >
          <title>{`${p.session.played_on} ${RATING_LABEL[p.session.rating]}`}</title>
        </circle>
      ))}

      <text x={PAD.left} y={H - 4} fill="#a8a29e" fontSize="10">
        {sessions[0].played_on.slice(5)}
      </text>
      {sessions.length > 1 && (
        <text x={W - PAD.right} y={H - 4} fill="#a8a29e" fontSize="10" textAnchor="end">
          {sessions[sessions.length - 1].played_on.slice(5)}
        </text>
      )}
    </svg>
  );
}
