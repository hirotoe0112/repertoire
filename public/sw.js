// 最小限の Service Worker。
// ネット前提のアプリなのでキャッシュ戦略は持たず、
// 「インストール可能にすること」と「Push を受け取ること」だけを担当する。

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// キャッシュせず素通しする (インストール要件を満たすためだけの fetch ハンドラ)
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let data = { title: 'レパートリー', body: '', url: '/', tag: 'daily' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
