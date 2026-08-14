// 維持アルゴリズムが設計どおりの数字になるかを確かめる簡易チェック。
// node scripts/check-schedule.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sched-'));
const out = join(dir, 'schedule.mjs');
execFileSync('npx', ['esbuild', 'worker/schedule.ts', '--bundle', '--format=esm', `--outfile=${out}`], {
  stdio: 'pipe',
});
const { applyRating, promote, maintenanceState, todaysPractice } = await import(out);
rmSync(dir, { recursive: true, force: true });

const settings = {
  daily_limit: 5,
  mult_excellent: 2.5,
  mult_good: 1.7,
  mult_shaky: 0.5,
  base_interval_days: 3,
  max_interval_days: 180,
  ease_min: 0.5,
  ease_max: 2.0,
};

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (期待 ${JSON.stringify(expected)})`}`);
};

// 昇格時: 基準3日から 1 回評価する (設計 Q35)
check('昇格 ◎ → 8日', promote('excellent', '2026-08-14', settings).interval_days, 8);
check('昇格 ○ → 5日', promote('good', '2026-08-14', settings).interval_days, 5);
check('昇格 △ → 2日', promote('shaky', '2026-08-14', settings).interval_days, 2);
check('昇格 × → 1日', promote('lost', '2026-08-14', settings).interval_days, 1);
check('昇格 ◎ の次回予定日', promote('excellent', '2026-08-14', settings).next_due, '2026-08-22');

// ◎ を重ねると間隔が伸び、ease も上がる
let piece = { interval_days: 8, ease: 1.0 };
piece = applyRating(piece, 'excellent', '2026-08-14', settings);
check('◎ 8日 → 20日', piece.interval_days, 20);
check('◎ で ease 1.05', Number(piece.ease.toFixed(2)), 1.05);
piece = applyRating(piece, 'excellent', '2026-09-03', settings);
check('◎ 20日 → 53日', piece.interval_days, 53);

// × は必ず 1 日に戻り、ease が下がる
const lost = applyRating({ interval_days: 53, ease: 1.1 }, 'lost', '2026-09-03', settings);
check('× → 1日', lost.interval_days, 1);
check('× で ease 0.95', Number(lost.ease.toFixed(2)), 0.95);

// 上限で頭打ちになる
check(
  '上限180日でクランプ',
  applyRating({ interval_days: 150, ease: 2.0 }, 'excellent', '2026-09-03', settings).interval_days,
  180,
);

// ease の下限
check(
  'ease は 0.5 未満にならない',
  applyRating({ interval_days: 10, ease: 0.5 }, 'shaky', '2026-09-03', settings).ease,
  0.5,
);

// 維持状態の判定
const base = {
  id: 1,
  status: 'active',
  interval_days: 10,
  ease: 1,
  next_due: '2026-08-20',
  last_rating: 'excellent',
};
check('予定日前は良好', maintenanceState(base, '2026-08-14'), 'ok');
check('予定日当日は今日やる', maintenanceState(base, '2026-08-20'), 'today');
check('間隔を超えて超過したら要復習', maintenanceState(base, '2026-09-01'), 'review');
check(
  '直近が△なら予定日前でも要復習',
  maintenanceState({ ...base, last_rating: 'shaky' }, '2026-08-14'),
  'review',
);
check('休眠は状態を持たない', maintenanceState({ ...base, status: 'dormant' }, '2026-08-14'), null);

// 今日のリスト: 要復習 → 超過の大きい順、上限で切る
const pieces = [
  { ...base, id: 1, next_due: '2026-08-13', last_rating: 'excellent' }, // 1日超過
  { ...base, id: 2, next_due: '2026-08-10', last_rating: 'excellent' }, // 4日超過
  { ...base, id: 3, next_due: '2026-08-14', last_rating: 'shaky' }, // 要復習
  { ...base, id: 4, next_due: '2026-08-20', last_rating: 'excellent' }, // まだ先
  { ...base, id: 5, status: 'dormant', next_due: null }, // 休眠
];
check(
  '今日のリストの並び',
  todaysPractice(pieces, '2026-08-14', 5).map((p) => p.id),
  [3, 2, 1],
);
check(
  '上限で切られる',
  todaysPractice(pieces, '2026-08-14', 2).map((p) => p.id),
  [3, 2],
);

console.log(failures === 0 ? '\nすべて期待どおり' : `\n${failures} 件が期待と違います`);
process.exit(failures === 0 ? 0 : 1);
