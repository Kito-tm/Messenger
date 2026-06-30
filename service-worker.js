self.addEventListener('push', function(event) {
  let data = { title: 'Новое сообщение', body: 'Вам кто-то написал!' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Новое сообщение', body: event.data.text() };
    }
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png', // путь к иконке
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: '/' // Ссылка, куда перейдет юзер при клике
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Открытие приложения при клике на уведомление
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
