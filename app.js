// 1. Импорт необходимых модулей Firebase SDK (CDN-версии)
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

// 2. Конфигурация вашего проекта Firebase
// Замените эти данные на ваши актуальные ключи из настроек Firebase Console!
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Инициализация Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 3. Поиск элементов интерфейса в DOM
const authContainer = document.getElementById("auth-container");
const chatContainer = document.getElementById("chat-container");
const usernameInput = document.getElementById("username-input");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const messagesDiv = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");

let currentUser = null;

// 4. Отслеживание состояния авторизации пользователя
onAuthStateChanged(auth, (user) => {
    if (user) {
        // Пользователь вошел в систему
        currentUser = user;
        showChatUI();
        loadMessages();
    } else {
        // Пользователь вышел из системы
        currentUser = null;
        showAuthUI();
    }
});

// 5. Функция входа (Анонимная авторизация + сохранение никнейма)
loginBtn.addEventListener("click", async () => {
    const username = usernameInput.value.trim();
    if (!username) {
        alert("Пожалуйста, введите свой никнейм перед входом!");
        return;
    }

    try {
        // Входим анонимно
        const userCredential = await signInAnonymously(auth);
        // Обновляем профиль пользователя, записывая туда введенное имя
        await updateProfile(userCredential.user, {
            displayName: username
        });
        console.log("Успешный вход под именем:", username);
    } catch (error) {
        console.error("Ошибка при авторизации:", error);
        alert("Не удалось войти: " + error.message);
    }
});

// 6. Функция выхода из аккаунта
logoutBtn.addEventListener("click", () => {
    signOut(auth).catch((error) => console.error("Ошибка при выходе:", error));
});

// 7. Отправка нового сообщения в Firestore
messageForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const messageText = messageInput.value.trim();
    if (!messageText || !currentUser) return;

    try {
        // Добавляем документ в коллекцию "messages"
        await addDoc(collection(db, "messages"), {
            text: messageText,
            uid: currentUser.uid,
            displayName: currentUser.displayName || "Аноним",
            createdAt: serverTimestamp() // Время сервера Firebase
        });
        
        // Очищаем поле ввода и возвращаем на него фокус
        messageForm.reset();
        messageInput.focus();
    } catch (error) {
        console.error("Ошибка при отправке сообщения:", error);
    }
});

// 8. Слушатель сообщений в реальном времени (Real-time listener)
function loadMessages() {
    // Формируем запрос: коллекция "messages", сортировка по времени, лимит — последние 50 штук
    const q = query(collection(db, "messages"), orderBy("createdAt", "asc"), limit(50));

    //onSnapshot мгновенно реагирует на любые изменения в базе данных
    onSnapshot(q, (snapshot) => {
        messagesDiv.innerHTML = ""; // Очищаем контейнер перед обновлением

        snapshot.forEach((doc) => {
            const data = doc.data();
            renderMessage(data);
        });

        scrollToBottom();
    }, (error) => {
        console.error("Ошибка получения сообщений:", error);
    });
}

// 9. Рендеринг одного сообщения на UI
function renderMessage(data) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message");

    // Проверяем, текущий ли это пользователь, для стилизации (свои/чужие)
    if (data.uid === currentUser.uid) {
        messageElement.classList.add("my-message");
    } else {
        messageElement.classList.add("other-message");
    }

    // Безопасное экранирование текста, чтобы избежать XSS-атак
    const safeText = escapeHTML(data.text);
    const safeName = escapeHTML(data.displayName);

    messageElement.innerHTML = `
        <span class="author">${safeName}:</span>
        <span class="text">${safeText}</span>
    `;
    
    messagesDiv.appendChild(messageElement);
}

// 10. Вспомогательные функции (Интерфейс и безопасность)
function showChatUI() {
    authContainer.classList.add("hidden");
    chatContainer.classList.remove("hidden");
}

function showAuthUI() {
    authContainer.classList.remove("hidden");
    chatContainer.classList.add("hidden");
    messagesDiv.innerHTML = "";
}

function scrollToBottom() {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Защита от вредоносного HTML-кода в сообщениях
function escapeHTML(str) {
    return str.replace(/[&<>"']/g, (match) => {
        const entityMap = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return entityMap[match];
    });
}
