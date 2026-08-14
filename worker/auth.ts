// 合言葉 1 つによる認証 (設計 3)。
// パスワードは PBKDF2-SHA256 で保存し、ログイン成功時に HMAC 署名付きトークンを発行する。
// HMAC の鍵にはパスワードハッシュ自体を使うので、追加のシークレット設定が要らず、
// パスワードを変更すると既存トークンが自動的に無効になる。

const PBKDF2_ITERATIONS = 100_000;
const TOKEN_DAYS = 365;

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, , saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const hash = await pbkdf2(password, b64urlDecode(saltB64));
  const expected = b64urlDecode(hashB64);
  if (hash.length !== expected.length) return false;
  // 定数時間比較
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ expected[i];
  return diff === 0;
}

async function hmacKey(passwordHash: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(passwordHash),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function issueToken(passwordHash: string): Promise<string> {
  const exp = String(Date.now() + TOKEN_DAYS * 86400000);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(passwordHash), enc.encode(exp));
  return `${exp}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifyToken(token: string, passwordHash: string): Promise<boolean> {
  const [exp, sig] = token.split('.');
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(passwordHash), b64urlDecode(sig), enc.encode(exp));
}
