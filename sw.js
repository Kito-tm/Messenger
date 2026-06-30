// sw.js - Фоновый сервис-воркер для обработки системных уведомлений
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Логика клика по системному пушу на телефоне (разворачивает вкладку с чатом)
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            if (clientList.length > 0) {
                let client = clientList[0];
                for (let i = 0; i < clientList.length; i++) {
                    if (clientList[i].focused) { client = clientList[i]; break; }
                }
                return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow('/');
        })
    );
});
