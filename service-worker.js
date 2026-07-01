// Слушатель фоновых Push-уведомлений от сервера
self.addEventListener('push', function(event) {
  let data = { title: 'Новое сообщение', body: 'Вам кто-то написал!' };

  if (event.data) {
    try {
      // Если сервер прислал JSON
      data = event.data.json();
    } catch (e) {
      // Если сервер прислал простой текст
      data = { title: 'Новое сообщение', body: event.data.text() };
    }
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png', // Убедись, что картинка лежит в корне папки
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: '/' // Ссылка, куда перейдет юзер при клике на уведомление
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Открытие приложения при клике на всплывающее уведомление
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
