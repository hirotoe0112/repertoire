// Web Push 用の VAPID 鍵ペアを作る。
// node scripts/gen-vapid.mjs
import { webcrypto } from 'node:crypto';

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);

const publicKey = b64url(await webcrypto.subtle.exportKey('raw', pair.publicKey));
const privateKey = b64url(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey));

console.log('VAPID_PUBLIC_KEY  =', publicKey);
console.log('VAPID_PRIVATE_KEY =', privateKey);
console.log('');
console.log('次のコマンドで Worker に登録してください:');
console.log(`  npx wrangler secret put VAPID_PUBLIC_KEY   # ${publicKey}`);
console.log('  npx wrangler secret put VAPID_PRIVATE_KEY');
console.log('  npx wrangler secret put VAPID_SUBJECT      # 例: mailto:you@example.com');
