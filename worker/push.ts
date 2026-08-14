// Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) を WebCrypto だけで実装する。
// 外部ライブラリを足さずに Cloudflare Workers 上で完結させるための最小実装。
import { b64urlDecode, b64urlEncode } from './auth';

const enc = new TextEncoder();

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  publicKey: string; // raw 65 バイトの base64url
  privateKey: string; // PKCS8 の base64url
  subject: string; // mailto: または https: の URL
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** VAPID の Authorization ヘッダ (ES256 で署名した JWT) を組み立てる */
async function vapidAuthHeader(endpoint: string, keys: VapidKeys): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64urlEncode(
    enc.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: keys.subject,
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    b64urlDecode(keys.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    enc.encode(signingInput),
  );
  return `vapid t=${signingInput}.${b64urlEncode(new Uint8Array(sig))}, k=${keys.publicKey}`;
}

/** RFC 8291 に従って本文を暗号化する */
async function encryptPayload(
  payload: string,
  sub: PushSubscriptionRow,
): Promise<{ body: Uint8Array }> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);

  const ephemeral = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', ephemeral.publicKey)) as ArrayBuffer,
  );

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  // workers-types の ECDH パラメータ名がランタイムと食い違うためキャストする
  const deriveAlgorithm = { name: 'ECDH', public: uaKey } as unknown as Parameters<
    SubtleCrypto['deriveBits']
  >[0];
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(deriveAlgorithm, ephemeral.privateKey, 256),
  );

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || ua_public || as_public, 32)
  const keyInfo = concat(enc.encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // レコード末尾に padding delimiter 0x02 を付ける (単一レコード)
  const record = concat(enc.encode(payload), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record),
  );

  // ヘッダ: salt(16) || record_size(4) || key_id_len(1) || as_public(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const body = concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
  return { body };
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** 1 件送信する。410/404 が返ったら購読が失効しているので削除すべき */
export async function sendPush(
  sub: PushSubscriptionRow,
  message: PushMessage,
  keys: VapidKeys,
): Promise<{ ok: boolean; status: number; expired: boolean }> {
  const { body } = await encryptPayload(JSON.stringify(message), sub);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthHeader(sub.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
  return { ok: res.ok, status: res.status, expired: res.status === 404 || res.status === 410 };
}
