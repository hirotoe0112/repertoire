// Web Push の暗号化 (RFC 8291) と VAPID 署名 (RFC 8292) が正しいかを往復で確かめる。
// 受信側 (ブラウザがやること) を Node 側で実装し、復号できるかを見る。
// node scripts/check-push.mjs
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const subtle = crypto.subtle;
const enc = new TextEncoder();
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const concat = (...a) => Buffer.concat(a.map(Buffer.from));

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
};

// worker/push.ts をバンドルして読み込む
const dir = mkdtempSync(join(tmpdir(), 'push-'));
const out = join(dir, 'push.mjs');
execFileSync('npx', ['esbuild', 'worker/push.ts', '--bundle', '--format=esm', `--outfile=${out}`], {
  stdio: 'pipe',
});
const { sendPush } = await import(out);
rmSync(dir, { recursive: true, force: true });

// --- 鍵の用意 -------------------------------------------------------------

const vapidPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const keys = {
  publicKey: b64url(await subtle.exportKey('raw', vapidPair.publicKey)),
  privateKey: b64url(await subtle.exportKey('pkcs8', vapidPair.privateKey)),
  subject: 'mailto:test@example.com',
};

// ブラウザ側の購読鍵
const uaPair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPublic = Buffer.from(await subtle.exportKey('raw', uaPair.publicKey));
const authSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));

// --- 受信側のサーバ -------------------------------------------------------

let captured = null;
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    captured = { headers: req.headers, body: Buffer.concat(chunks) };
    res.writeHead(201).end();
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/push/abc`;

const message = { title: '今日の維持練習', body: '3曲（ショパン バラード第1番 ほか）', url: '/' };
const result = await sendPush(
  { endpoint, p256dh: b64url(uaPublic), auth: b64url(authSecret) },
  message,
  keys,
);
server.close();

check('送信が成功する', result.ok, `status=${result.status}`);
check('Content-Encoding が aes128gcm', captured?.headers['content-encoding'] === 'aes128gcm');

// --- VAPID の JWT を検証 --------------------------------------------------

const auth = captured.headers.authorization ?? '';
const t = auth.match(/t=([^,\s]+)/)?.[1];
const k = auth.match(/k=([^,\s]+)/)?.[1];
check('Authorization が vapid 形式', auth.startsWith('vapid ') && !!t && !!k);
check('k が VAPID 公開鍵と一致', k === keys.publicKey);

const [jwtHeader, jwtPayload, jwtSig] = t.split('.');
const verified = await subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' },
  vapidPair.publicKey,
  unb64url(jwtSig),
  enc.encode(`${jwtHeader}.${jwtPayload}`),
);
check('JWT の署名が検証できる', verified);
const payload = JSON.parse(unb64url(jwtPayload).toString());
check('aud がエンドポイントのオリジン', payload.aud === new URL(endpoint).origin, payload.aud);
check('exp が未来', payload.exp > Math.floor(Date.now() / 1000));

// --- 本文を復号する (ブラウザがやること) ----------------------------------

const body = captured.body;
const salt = body.subarray(0, 16);
const idLen = body[20];
const asPublic = body.subarray(21, 21 + idLen);
const ciphertext = body.subarray(21 + idLen);
check('レコードサイズが 4096', body.readUInt32BE(16) === 4096);
check('鍵IDの長さが 65 (非圧縮の公開鍵)', idLen === 65);

const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const shared = new Uint8Array(
  await subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPair.privateKey, 256),
);

const hkdf = async (saltBytes, ikm, info, length) => {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info },
      key,
      length * 8,
    ),
  );
};

const keyInfo = concat(enc.encode('WebPush: info'), Buffer.from([0]), uaPublic, asPublic);
const ikm = await hkdf(authSecret, shared, keyInfo, 32);
const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

const aesKey = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
const plainBuf = Buffer.from(
  await subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, ciphertext),
);
check('末尾のパディング区切りが 0x02', plainBuf[plainBuf.length - 1] === 2);

const decoded = JSON.parse(plainBuf.subarray(0, plainBuf.length - 1).toString('utf8'));
check('復号した中身が送信内容と一致', JSON.stringify(decoded) === JSON.stringify(message), decoded.body);

console.log(failures === 0 ? '\nWeb Push の往復に成功' : `\n${failures} 件が失敗`);
process.exit(failures === 0 ? 0 : 1);
