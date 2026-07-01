import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
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

// Новые динамические элементы UI (создаются автоматически)
const recordingOverlay = document.createElement("div");
recordingOverlay.id = "recording-overlay";
recordingOverlay.className = "recording-overlay hidden";
recordingOverlay.innerHTML = `
    <span class="blink-dot"></span>
    <span id="record-timer">00:00</span>
    <span class="swipe-hint">▲ Смахните вверх для фиксации</span>
`;
messageForm.insertBefore(recordingOverlay, messageInput);

const previewOverlay = document.createElement("div");
previewOverlay.id = "preview-overlay";
previewOverlay.className = "preview-overlay hidden";
messageForm.insertBefore(previewOverlay, messageInput);

let currentUser = null;
let currentMode = 'voice'; 
let mediaRecorder = null;
let recordedChunks = [];
let mediaStream = null;
let recordStartTime = 0;
let isRecording = false;

// Состояния для фиксации записи и превью
let isLocked = false;
let startPointerY = 0;
let timerInterval = null;
let localPreviewBlob = null;

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

messageInput.addEventListener("input", () => {
    if (previewOverlay.classList.contains("hidden")) {
        if (messageInput.value.trim().length > 0) {
            updateActionButtonMode('send');
        } else {
            updateActionButtonMode(currentMode === 'send' ? 'voice' : currentMode);
        }
    }
});

function updateActionButtonMode(mode) {
    const icon = actionBtn.querySelector("i");
    if (!icon) return;
    icon.className = ""; 
    
    if (mode === 'send') {
        icon.className = "fa-solid fa-paper-plane";
    } else if (mode === 'voice') {
        icon.className = "fa-solid fa-microphone";
        currentMode = 'voice';
    } else if (mode === 'video') {
        icon.className = "fa-solid fa-video";
        currentMode = 'video';
    } else if (mode === 'stop') {
        icon.className = "fa-solid fa-square"; // Квадрат остановки
    }
}

// Умный выбор кодеков, чтобы iOS понимала файлы
function getSupportedMimeType(mode) {
    if (mode === 'voice') {
        const types = ['audio/mp4', 'audio/aac', 'audio/webm', 'audio/ogg'];
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) return type;
        }
    } else {
        const types = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm'];
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) return type;
        }
    }
    return ''; 
}

messageForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !currentUser) return;
    sendMessage({ type: 'text', text: text });
    messageForm.reset();
    updateActionButtonMode('voice');
});

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
    fileInput.value = ""; 
});

// ==========================================
// ЛОГИКА УДЕРЖАНИЯ, СВАЙПА И ПРЕВЬЮ
// ==========================================

actionBtn.addEventListener("click", (e) => {
    // 1. Если мы в режиме превью — кнопка отправляет локальный файл
    if (localPreviewBlob) {
        sendLocalPreview();
        return;
    }
    // 2. Если запись зафиксирована (Lock) — нажатие на «квадрат» останавливает её и выводит превью
    if (isRecording && isLocked) {
        stopRecordingHandler(true);
        return;
    }
    // 3. Отправка текста
    if (messageInput.value.trim().length > 0) {
        messageForm.requestSubmit();
        return;
    }
    // 4. Обычное переключение режимов
    if (!isRecording) {
        updateActionButtonMode(currentMode === 'voice' ? 'video' : 'voice');
    }
});

actionBtn.addEventListener("pointerdown", async (e) => {
    if (messageInput.value.trim().length > 0 || localPreviewBlob) return;
    e.preventDefault();
    
    recordStartTime = Date.now();
    isRecording = true;
    isLocked = false;
    startPointerY = e.clientY;
    
    actionBtn.classList.add("recording");
    recordingOverlay.classList.remove("hidden");
    messageInput.classList.add("hidden");
    
    // Запуск таймера
    let seconds = 0;
    const timerElement = document.getElementById("record-timer");
    timerElement.innerText = "00:00";
    timerInterval = setInterval(() => {
        seconds++;
        const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
        const secs = String(seconds % 60).padStart(2, '0');
        timerElement.innerText = `${mins}:${secs}`;
    }, 1000);
    
    try {
        const constraints = currentMode === 'voice' 
            ? { audio: true, video: false } 
            : { audio: true, video: { width: 400, height: 400, facingMode: "user" } };
            
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
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
        const mimeType = getSupportedMimeType(currentMode);
        const options = mimeType ? { mimeType } : {};
        
        mediaRecorder = new MediaRecorder(mediaStream, options);
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) recordedChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            cameraPreview.style.display = "none";
            cameraPreview.srcObject = null;
            
            const duration = Date.now() - recordStartTime;
            if (duration < 400) {
                cleanupMedia();
                return;
            }
            
            const mimeUsed = mediaRecorder.mimeType || (currentMode === 'voice' ? 'audio/webm' : 'video/webm');
            localPreviewBlob = new Blob(recordedChunks, { type: mimeUsed });
            
            // Если была фиксация (Lock) — не отправляем сразу, а показываем превью
            if (isLocked) {
                showPreviewUI();
            } else {
                // Если обычное удержание — пушим в базу мгновенно
                await uploadAndSendBlob(localPreviewBlob, currentMode);
                cleanupMedia();
            }
        };
        
        mediaRecorder.start();
    } catch (err) {
        alert("Доступ к микрофону/камере заблокирован.");
        cleanupMedia();
    }
});

// Отслеживание свайпа вверх для блокировки (Lock)
window.addEventListener("pointermove", (e) => {
    if (!isRecording || isLocked) return;
    
    const dragDistance = startPointerY - e.clientY;
    if (dragDistance > 60) { // Если протянул вверх больше чем на 60px
        isLocked = true;
        actionBtn.classList.remove("recording");
        actionBtn.classList.add("locked-recording");
        updateActionButtonMode('stop');
        document.querySelector(".swipe-hint").innerText = "Запись зафиксирована";
    }
});

const stopRecordingHandler = (forcedStopByLock = false) => {
    if (!isRecording) return;
    
    // Если запись «залочена», то отпускание пальца её НЕ останавливает
    if (isLocked && !forcedStopByLock) return; 
    
    isRecording = false;
    clearInterval(timerInterval);
    recordingOverlay.classList.add("hidden");
    
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }
};

window.addEventListener("pointerup", () => stopRecordingHandler(false));

// Показ панели предварительного прослушивания
function showPreviewUI() {
    previewOverlay.innerHTML = "";
    previewOverlay.classList.remove("hidden");
    
    const objectURL = URL.createObjectURL(localPreviewBlob);
    let previewEl;
    
    if (currentMode === 'voice') {
        previewEl = document.createElement("audio");
        previewEl.controls = true;
    } else {
        previewEl = document.createElement("video");
        previewEl.className = "video-circle-preview";
        previewEl.autoplay = true;
        previewEl.muted = false;
        previewEl.controls = true;
    }
    previewEl.src = objectURL;
    
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "preview-delete-btn";
    deleteBtn.innerHTML = `<i class="fa-solid fa-trash"></i>`;
    deleteBtn.onclick = () => {
        cleanupMedia();
    };
    
    previewOverlay.appendChild(deleteBtn);
    previewOverlay.appendChild(previewEl);
    
    updateActionButtonMode('send');
}

async function sendLocalPreview() {
    if (!localPreviewBlob) return;
    const modeToSend = currentMode; 
    const blobToSend = localPreviewBlob;
    
    cleanupMedia(); // Очищаем UI, не дожидаясь загрузки в сеть
    await uploadAndSendBlob(blobToSend, modeToSend);
}

async function uploadAndSendBlob(blob, mode) {
    const ext = mode === 'voice' ? (blob.type.includes('mp4') ? 'mp4' : 'webm') : 'mp4';
    const fileRef = ref(storage, `chats/media/${Date.now()}.${ext}`);
    const uploadTask = uploadBytesResumable(fileRef, blob);
    
    uploadTask.on('state_changed', null, (err) => console.error(err), async () => {
        const url = await getDownloadURL(uploadTask.snapshot.ref);
        sendMessage({ type: mode, fileUrl: url });
    });
}

function cleanupMedia() {
    isRecording = false;
    isLocked = false;
    localPreviewBlob = null;
    clearInterval(timerInterval);
    
    actionBtn.className = ""; 
    actionBtn.id = "action-btn";
    
    recordingOverlay.classList.add("hidden");
    previewOverlay.classList.add("hidden");
    previewOverlay.innerHTML = "";
    messageInput.classList.remove("hidden");
    
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    updateActionButtonMode(messageInput.value.trim().length > 0 ? 'send' : 'voice');
}

// ==========================================
// ПОЛУЧЕНИЕ, РЕНДЕРИНГ И УДАЛЕНИЕ СООБЩЕНИЙ
// ==========================================
function loadMessages() {
    const q = query(collection(db, "messages"), orderBy("createdAt", "asc"), limit(50));
    onSnapshot(q, (snapshot) => {
        messagesDiv.innerHTML = "";
        snapshot.forEach((docSnap) => renderMessage(docSnap.id, docSnap.data()));
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
}

function renderMessage(docId, data) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", data.uid === currentUser.uid ? "my-message" : "other-message");
    messageElement.setAttribute("data-id", docId);
    messageElement.setAttribute("data-uid", data.uid);
    
    const safeName = escapeHTML(data.displayName);
    let contentHtml = "";

    if (data.type === 'image') {
        contentHtml = `<img src="${data.fileUrl}" class="chat-image" alt="Картинка">`;
    } else if (data.type === 'voice') { 
        contentHtml = `<audio src="${data.fileUrl}" controls></audio>`;
    } else if (data.type === 'video') {
        contentHtml = `<video src="${data.fileUrl}" class="video-circle" autoplay loop muted playsinline onclick="this.paused ? this.play() : this.pause(); this.muted = !this.muted;"></video>`;
    } else {
        contentHtml = `<span class="text">${escapeHTML(data.text)}</span>`;
    }

    messageElement.innerHTML = `<span class="author">${safeName}:</span> ${contentHtml}`;
    
    // НАВЕШИВАНИЕ ДОЛГОГО НАЖАТИЯ ДЛЯ УДАЛЕНИЯ
    let pressTimer;
    const startPress = (e) => {
        pressTimer = setTimeout(() => {
            showDeleteMenu(docId, data.uid, messageElement);
        }, 600); // 600мс удержания
    };
    const cancelPress = () => clearTimeout(pressTimer);
    
    messageElement.addEventListener("pointerdown", startPress);
    messageElement.addEventListener("pointerup", cancelPress);
    messageElement.addEventListener("pointerleave", cancelPress);

    messagesDiv.appendChild(messageElement);
}

// Контекстное меню удаления
function showDeleteMenu(docId, authorUid, element) {
    // Удаляем старые открытые меню, если они есть
    const oldMenu = document.getElementById("custom-context-menu");
    if (oldMenu) oldMenu.remove();

    const menu = document.createElement("div");
    menu.id = "custom-context-menu";
    menu.className = "context-menu";
    
    // Логика кнопок в зависимости от того, чье сообщение
    if (currentUser && currentUser.uid === authorUid) {
        menu.innerHTML = `
            <button id="del-everyone">Удалить для всех</button>
            <button id="del-me">Удалить у себя</button>
            <button id="del-cancel">Отмена</button>
        `;
    } else {
        menu.innerHTML = `
            <button id="del-me">Удалить у себя</button>
            <button id="del-cancel">Отмена</button>
        `;
    }

    document.body.appendChild(menu);
    
    // Позиционирование меню рядом с сообщением
    const rect = element.getBoundingClientRect();
    menu.style.top = `${rect.top + window.scrollY}px`;
    menu.style.left = `${rect.left + window.scrollX}px`;

    menu.querySelector("#del-cancel").onclick = () => menu.remove();
    
    menu.querySelector("#del-me").onclick = () => {
        element.remove(); // Просто скрываем из DOM локально
        menu.remove();
    };

    const delEveryoneBtn = menu.querySelector("#del-everyone");
    if (delEveryoneBtn) {
        delEveryoneBtn.onclick = async () => {
            if (confirm("Удалить это сообщение для всех участников?")) {
                try {
                    await deleteDoc(doc(db, "messages", docId));
                } catch (err) { console.error("Не удалось удалить из базы:", err); }
            }
            menu.remove();
        };
    }

    // Закрытие меню при клике в любое другое место
    setTimeout(() => {
        window.addEventListener("click", function closeMenu() {
            menu.remove();
            window.removeEventListener("click", closeMenu);
        });
    }, 10);
}

function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(err => console.error(err));
}
