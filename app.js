// ==========================================
// 1. ИМПОРТЫ FIREBASE SDK
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    signInAnonymously, 
    onAuthStateChanged, 
    updateProfile, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    query, 
    orderBy, 
    limit, 
    onSnapshot, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ==========================================
// 2. КОНФИГУРАЦИЯ FIREBASE
// ==========================================
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ==========================================
// 3. ДОМ-ЭЛЕМЕНТЫ ИНТЕРФЕЙСА
// ==========================================
const authContainer = document.getElementById("auth-container");
const chatContainer = document.getElementById("chat-container");
const usernameInput = document.getElementById("username-input");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const messagesDiv = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const pushBtn = document.getElementById("push-btn"); // Кнопка "Включить уведомления", если она есть

let currentUser = null;

// ==========================================
// 4. АВТОРИЗАЦИЯ И РАБОТА С ЧАТОМ
// ==========================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        showChatUI();
        loadMessages();
    } else {
        currentUser = null;
        showAuthUI();
    }
});

loginBtn.addEventListener("click", async () => {
    const username = usernameInput.value.trim();
    if (!username) {
        alert("Пожалуйста, введите никнейм!");
        return;
    }
    try {
        const userCredential = await signInAnonymously(auth);
        await updateProfile(userCredential.user, { displayName: username });
    } catch (error) {
        console.error("Ошибка входа:", error);
    }
});

logoutBtn.addEventListener("click", () => {
    signOut(auth).catch((error) => console.error("Ошибка выхода:", error));
});

messageForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const messageText = messageInput.value.trim();
    if (!messageText || !currentUser) return;

    try {
        await addDoc(collection(db, "messages"), {
            text: messageText,
            uid: currentUser.uid,
            displayName: currentUser.displayName || "Аноним",
            createdAt: serverTimestamp()
        });
        messageForm.reset();
        messageInput.focus();
    } catch (error) {
        console.error("Ошибка отправки:", error);
    }
});

function loadMessages() {
    const q = query(collection(db, "messages"), orderBy("createdAt", "asc"), limit(50));
    onSnapshot(q, (snapshot) => {
        messagesDiv.innerHTML = "";
        snapshot.forEach((doc) => renderMessage(doc.data()));
        scrollToBottom();
    });
}

function renderMessage(data) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", data.uid === currentUser.uid ? "my-message" : "other-message");
    
    const safeText = escapeHTML(data.text);
    const safeName = escapeHTML(data.displayName);

    messageElement.innerHTML = `<span class="author">${safeName}:</span> <span class="text">${safeText}</span>`;
    messagesDiv.appendChild(messageElement);
}

// ==========================================
// 5. РЕГИСТРАЦИЯ СЕРВИС-ВОРКЕРА И PUSH
// ==========================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js')
    .then(reg => console.log('Сервис-воркер успешно готов:', reg))
    .catch(err => console.error('Ошибка воркера:', err));
}

async function subscribeUserToPush() {
  if (!('Notification' in window)) {
    alert('На iPhone push-уведомления работают только через экран «Домой» (Поделиться -> На экран "Домой").');
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('Запрос на уведомления отклонен.');
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  if (!registration.pushManager) {
    alert('Браузер не поддерживает Push-сообщения.');
    return;
  }

  try {
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array('ТВОЙ_ПУБЛИЧНЫЙ_VAPID_КЛЮЧ') // Замени на свой реальный VAPID ключ
    });

    console.log('Успешная подписка:', subscription);
    // Здесь отправляешь subscription на свой бэкенд сервер, если нужно
    alert('Уведомления успешно настроены!');
  } catch (error) {
    console.error('Ошибка подписки на push:', error);
    alert('Не удалось подписаться: ' + error.message);
  }
}

// Слушатель для кнопки пушей (если она есть на UI)
if (pushBtn) {
    pushBtn.addEventListener("click", subscribeUserToPush);
}

// ==========================================
// 6. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==========================================
function showChatUI() {
    authContainer.classList.add("hidden");
    chatContainer.classList.remove("hidden");
}

function showAuthUI() {
    authContainer.classList.remove("hidden");
    chatContainer.classList.add("hidden");
    messagesDiv.innerHTML = "";
}

function scrollToBottom() { messagesDiv.scrollTop = messagesDiv.scrollHeight; }

function escapeHTML(str) {
    return str.replace(/[&<>"']/g, (match) => {
        const entityMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return entityMap[match];
    });
}

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
