# レパートリー維持アプリ

ピアノのレパートリーを維持するための練習スケジューラ。Windows のブラウザと Android の PWA から
同じデータを見る。設計の意図と決定の経緯は [DESIGN.md](./DESIGN.md) に全部書いてある。

- フロント: Vite + React + TypeScript（UIライブラリなし）
- サーバ: Cloudflare Workers（静的アセット配信 + API + Cron Trigger）
- DB: Cloudflare D1
- 通知: Web Push（VAPID）

## 構成

```
index.html            SPA の入口
src/                  React の画面 (ホーム / 全曲一覧 / 曲の詳細 / 設定)
worker/               API・認証・維持アルゴリズム・Web Push・定時処理
shared/types.ts       フロントとサーバで共有する型
schema.sql            D1 のスキーマ
scripts/              アイコン生成 / VAPID 鍵生成 / アルゴリズムの検算
```

## 初回セットアップ

Cloudflare の無料アカウントが要る（クレジットカード不要）。

```bash
npm install

# 1. Cloudflare にログイン（ブラウザが開くので承認する）
npx wrangler login

# 2. D1 データベースを作り、出力された database_id を wrangler.jsonc に貼る
npx wrangler d1 create repertoire

# 3. スキーマを適用
npm run db:init

# 4. デプロイ
npm run deploy
```

デプロイ後に表示される `https://repertoire.<アカウント名>.workers.dev` を開き、
最初の画面で合言葉を決める。以降その合言葉でログインする。

### 通知を有効にする

```bash
# VAPID 鍵ペアを作る
node scripts/gen-vapid.mjs

# 出力された値を Worker のシークレットに登録する
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT     # 例: mailto:you@example.com

npm run deploy
```

Android では Chrome でアプリを開き「ホーム画面に追加」してから、
設定画面の「通知 → 有効にする」を押す。

## 開発

```bash
# 型チェック
npx tsc -b

# 維持アルゴリズムの検算
node scripts/check-schedule.mjs

# ローカルで動かす（Cloudflare アカウント不要）
npm run db:init:local
npm run build
npx wrangler dev --local          # http://127.0.0.1:8787
```

`npm run dev`（Vite の開発サーバ）を使う場合は、別ターミナルで `npx wrangler dev --local`
を動かしておく。`/api` へのリクエストは 8787 番へ転送される。

## 動きの要点

- **記録できるのは「人前で弾ける」曲だけ。** 休眠・復活中の曲はスケジュールに乗らない。
- **「人前で弾ける」へ上げるときは必ず手応えの評価が要る**（そこが維持スケジュールの出発点になる）。
- **評価は「今日の演奏の結果」ではなく「いま、この曲がどれくらい弾ける状態か」**。
  部分練習だけの日でも判定できるので、通し／部分の区別は持たない。
- **同じ曲は 1 日 1 記録**。押し直すと、その日の記録を付ける前の状態から計算し直す。
- **取り消し**は記録も昇格も直前の状態へ戻す。
- 日付はすべて JST 固定。Cron は毎時起動し、設定された時刻に一致したときだけ通知を送る。
