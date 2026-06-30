// 1. Сначала регистрируем сервис-воркер при загрузке страницы
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js')
    .then(reg => console.log('Сервис-воркер успешно готов:', reg))
    .catch(err => console.error('Ошибка воркера:', err));
}

// 2. Функция, которая вызывается при нажатии на кнопку "Включить уведомления"
async function subscribeUserToPush() {
  // ПРОВЕРКА №1: Есть ли вообще поддержка уведомлений?
  if (!('Notification' in window)) {
    // Если это iOS и сайт открыт просто в Safari, мы попадем сюда!
    alert('На iPhone push-уведомления работают только если добавить приложение на экран «Домой». Нажмите «Поделиться» -> «На экран "Домой"»');
    return;
  }

  // ПРОВЕРКА №2: Запрашиваем разрешение у пользователя
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('Вы отклонили запрос на уведомления. Разрешите их в настройках телефона для этого приложения.');
    return;
  }

  // ПРОВЕРКА №3: Проверяем PushManager
  const registration = await navigator.serviceWorker.ready;
  if (!registration.pushManager) {
    alert('Ваш браузер не поддерживает Push-сообщения.');
    return;
  }

  // ПОДПИСКА: Если всё прошло успешно, генерируем токен подписки
  try {
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array('ТВОЙ_ПУБЛИЧНЫЙ_VAPID_КЛЮЧ') 
      // Вместо этой строки вставь свой публичный ключ (VAPID) от бэкенда
    });

    console.log('Успешная подписка:', subscription);
    
    // Отправляем подписку (токен) на твой сервер Node.js / Python / PHP
    await sendSubscriptionToServer(subscription); 
    
    alert('Уведомления успешно настроены!');
  } catch (error) {
    console.error('Ошибка подписки на push:', error);
    alert('Не удалось подписаться на уведомления: ' + error.message);
  }
}

// Вспомогательная функция для перевода VAPID ключа (если у тебя её еще нет)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
