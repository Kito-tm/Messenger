import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
// Подключаем Firebase Storage для картинок и медиафайлов
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ==========================================
// КОНФИГУРАЦИЯ FIREBASE (Замени на свои данные!)
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
const storage = getStorage(app);

// DOM элементы
const authContainer = document.getElementById("auth-container");
const chatContainer = document.getElementById("chat-container");
const usernameInput = document.getElementById("username-input");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const messagesDiv = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const attachBtn = document.getElementById("attach-btn");
const fileInput = document.getElementById("file-input");
const actionBtn = document.getElementById("action-btn");
const cameraPreview = document.getElementById("camera-preview");

let currentUser = null;
let currentMode = 'voice'; // Может быть 'send', 'voice', 'video'
let mediaRecorder = null;
let recordedChunks = [];
let mediaStream = null;
let recordStartTime = 0;
let isRecording = false;

// Наблюдение за авторизацией
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        authContainer.classList.add("hidden");
        chatContainer.classList.remove("hidden");
        loadMessages();
    } else {
        currentUser = null;
        authContainer.classList.remove("hidden");
        chatContainer.classList.add("hidden");
        messagesDiv.innerHTML = "";
    }
});

loginBtn.addEventListener("click", async () => {
    const username = usernameInput.value.trim();
    if (!username) return alert("Введите никнейм!");
    try {
        const cred = await signInAnonymously(auth);
        await updateProfile(cred.user, { displayName: username });
    } catch (err) { console.error(err); }
});

logoutBtn.addEventListener("click", () => signOut(auth));

// Смена иконки кнопки в зависимости от текста
messageInput.addEventListener("input", () => {
    if (messageInput.value.trim().length > 0) {
        updateActionButtonMode('send');
    } else {
        updateActionButtonMode(currentMode === 'send' ? 'voice' : currentMode);
    }
});

function updateActionButtonMode(mode) {
    if (messageInput.value.trim().length > 0 && mode !== 'send') return;
    
    const icon = actionBtn.querySelector("i");
    if (!icon) return;
    
    icon.className = ""; // сброс классов
    
    if (mode === 'send') {
        icon.className = "fa-solid fa-paper-plane";
    } else if (mode === 'voice') {
        icon.className = "fa-solid fa-microphone";
        currentMode = 'voice';
    } else if (mode === 'video') {
        icon.className = "fa-solid fa-video";
        currentMode = 'video';
    }
}

// Отправка текстовых сообщений
messageForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !currentUser) return;
    sendMessage({ type: 'text', text: text });
    messageForm.reset();
    updateActionButtonMode('voice');
});

// Универсальная функция пуша в Firestore
async function sendMessage(payload) {
    try {
        await addDoc(collection(db, "messages"), {
            uid: currentUser.uid,
            displayName: currentUser.displayName || "Аноним",
            createdAt: serverTimestamp(),
            ...payload
        });
    } catch (err) { console.error("Ошибка сохранения сообщения:", err); }
}

// Загрузка картинок (скрепка)
attachBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !currentUser) return;
    
    const fileRef = ref(storage, `chats/images/${Date.now()}_${file.name}`);
    const uploadTask = uploadBytesResumable(fileRef, file);
    
    uploadTask.on('state_changed', null, (err) => console.error(err), async () => {
        const url = await getDownloadURL(uploadTask.snapshot.ref);
        sendMessage({ type: 'image', fileUrl: url, text: `Фото: ${file.name}` });
    });
    fileInput.value = ""; // Сброс
});

// ==========================================
// ЛОГИКА УДЕРЖАНИЯ ДЛЯ ЗАПИСИ (Голосовые и Кружки)
// ==========================================

// Переключение режимов Голос/Кружок по короткому клику
actionBtn.addEventListener("click", (e) => {
    if (messageInput.value.trim().length > 0) {
        messageForm.requestSubmit(); // если есть текст - отправляем форму
        return;
    }
    // Если текста нет, короткий клик меняет режим
    if (!isRecording) {
        updateActionButtonMode(currentMode === 'voice' ? 'video' : 'voice');
    }
});

// Обработка долгого зажатия (работает на ПК и смартфонах)
actionBtn.addEventListener("pointerdown", async (e) => {
    if (messageInput.value.trim().length > 0) return;
    e.preventDefault();
    
    recordStartTime = Date.now();
    isRecording = true;
    actionBtn.classList.add("recording");
    
    // Запускаем запись медиа потока
    try {
        const constraints = currentMode === 'voice' 
            ? { audio: true, video: false } 
            : { audio: true, video: { width: 400, height: 400, facingMode: "user" } };
            
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // ЗАЩИТА: Если пользователь уже отпустил кнопку, пока запрашивался доступ
        if (!isRecording) {
            stream.getTracks().forEach(track => track.stop());
            return;
        }
        
        mediaStream = stream;
        
        if (currentMode === 'video') {
            cameraPreview.srcObject = mediaStream;
            cameraPreview.style.display = "block";
        }
        
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(mediaStream);
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) recordedChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            cameraPreview.style.display = "none";
            cameraPreview.srcObject = null;
            
            const duration = Date.now() - recordStartTime;
            // Если удержание было меньше 400мс, считаем это случайным тапом и не отправляем
            if (duration < 400) {
                cleanupMedia();
                return;
            }
            
            const blobType = currentMode === 'voice' ? 'audio/webm' : 'video/webm';
            const blob = new Blob(recordedChunks, { type: blobType });
            const ext = currentMode === 'voice' ? 'webm' : 'mp4';
            
            const fileRef = ref(storage, `chats/media/${Date.now()}.${ext}`);
            const uploadTask = uploadBytesResumable(fileRef, blob);
            
            const currentRecordMode = currentMode; // фиксируем режим перед отправкой
            uploadTask.on('state_changed', null, (err) => console.error(err), async () => {
                const url = await getDownloadURL(uploadTask.snapshot.ref);
                sendMessage({ type: currentRecordMode, fileUrl: url });
            });
            
            cleanupMedia();
        };
        
        mediaRecorder.start();
    } catch (err) {
        alert("Не удалось получить доступ к микрофону/камере.");
        cleanupMedia();
    }
});

// Окончание удержания кнопки
const stopRecordingHandler = () => {
    if (!isRecording) return;
    isRecording = false;
    actionBtn.classList.remove("recording");
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }
};

actionBtn.addEventListener("pointerup", stopRecordingHandler);
actionBtn.addEventListener("pointerleave", stopRecordingHandler); // если палец/мышка съехали с кнопки

function cleanupMedia() {
    isRecording = false;
    actionBtn.classList.remove("recording");
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
}

// ==========================================
// ПОЛУЧЕНИЕ И РЕНДЕРИНГ СООБЩЕНИЙ
// ==========================================
function loadMessages() {
    const q = query(collection(db, "messages"), orderBy("createdAt", "asc"), limit(50));
    onSnapshot(q, (snapshot) => {
        messagesDiv.innerHTML = "";
        snapshot.forEach((doc) => renderMessage(doc.data()));
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
}

function renderMessage(data) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", data.uid === currentUser.uid ? "my-message" : "other-message");
    
    const safeName = escapeHTML(data.displayName);
    let contentHtml = "";

    // Динамически рендерим контент в зависимости от его типа
    if (data.type === 'image') {
        contentHtml = `<img src="${data.fileUrl}" class="chat-image" alt="Картинка">`;
    } else if (data.type === 'voice') { // ИСПРАВЛЕНО: Было 'audio', стало 'voice'
        contentHtml = `<audio src="${data.fileUrl}" controls></audio>`;
    } else if (data.type === 'video') {
        contentHtml = `<video src="${data.fileUrl}" class="video-circle" autoplay loop muted playsinline onclick="this.paused ? this.play() : this.pause(); this.muted = !this.muted;"></video>`;
    } else {
        contentHtml = `<span class="text">${escapeHTML(data.text)}</span>`;
    }

    messageElement.innerHTML = `<span class="author">${safeName}:</span> ${contentHtml}`;
    messagesDiv.appendChild(messageElement);
}

function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// Сервис-воркер под капотом (Регистрация для PWA)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(err => console.error(err));
}
