// Получаем функции Firebase из глобального объекта window (куда их передал index.html)
const { db, ref, push, onValue, set, update, get, onDisconnect } = window;

// ЛОКАЛЬНОЕ ХРАНИЛИЩЕ С КЭШИРОВАНИЕМ ВЫЗОВОВ
const store = {
    set: (k, v) => { try { localStorage.setItem(k, v); } catch(e) { window['_m_' + k] = v; } },
    get: (k) => { try { return localStorage.getItem(k); } catch(e) { return window['_m_' + k] || null; } },
    clear: () => { try { localStorage.clear(); } catch(e) { Object.keys(window).forEach(x => { if(x.startsWith('_m_')) delete window[x]; }); } }
};

let user = null, displayName = null, avatar = null, userColor = '#5288c1', mode = 'sidebar', activeChat = null, activeChatName = '', activeChatAvatar = '';
let knownUsers = {}, onlineStatus = {}, typingStatus = {}, activeConversations = {}, liveListeners = {}, liveGroupData = {};
let isNetworkOnline = true, isWindowFocused = true, lastDateStr = null, toastTimeout = null;
let groupAvatarBase64 = null, modalAvatarBase64 = null;

// Контекстное меню
let contextMenuMessageId = null, contextMenuMessageData = null, contextMenuElement = null;

// Медиа-рекордер (Голосовые/Кружки)
let mediaRecorder = null, recordedChunks = [], mediaStream = null, recordStartTime = 0;
let currentMode = 'voice', isRecording = false, isLocked = false, startPointerY = 0, timerInterval = null, localPreviewBlob = null;

const $ = id => document.getElementById(id);

// Мониторинг сети и статуса присутствия
window.addEventListener('online', () => { isNetworkOnline = true; setOnlineStatus(true); });
window.addEventListener('offline', () => { isNetworkOnline = false; setOnlineStatus(false); });
window.addEventListener('focus', () => { isWindowFocused = true; if(user) update(ref(db, `users/${user}`), { online: true }); });
window.addEventListener('blur', () => { isWindowFocused = false; });

const setOnlineStatus = (st) => {
    if (user && st && isNetworkOnline) {
        update(ref(db, `users/${user}`), { online: true });
        onDisconnect(ref(db, `users/${user}/online`)).set(false);
    }
};

// Сжатие и конвертация картинок в Base64
const resizeAndConvertBase64 = (file, maxW, maxH, callback) => {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            let w = img.width, h = img.height;
            if (w > maxW || h > maxH) {
                if (w > h) { h = Math.round((h * maxW) / w); w = maxW; }
                else { w = Math.round((w * maxH) / h); h = maxH; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            callback(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

// БЕЗОПАСНОЕ ДЕХЕШИРОВАНИЕ / РАБОТА С ПАРОЛЯМИ
const simpleHash = (str) => btoa(encodeURIComponent(str));
const simpleDecode = (str) => str ? decodeURIComponent(atob(str)) : '';

// ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ И СЛУШАТЕЛИ В РЕАЛЬНОМ ВРЕМЕНИ
const initApp = () => {
    $('login-screen').classList.add('hidden');
    $('app-container').classList.remove('hidden');
    setOnlineStatus(true);

    $('burger-my-name').innerText = displayName;
    $('burger-my-username').innerText = '@' + user;
    $('burger-my-avatar').src = avatar;

    // Подписка на пользователей
    onValue(ref(db, 'users'), (snap) => {
        if(snap.exists()) {
            knownUsers = snap.val();
            buildChatsList();
            if (activeChat && !activeChat.startsWith('group_')) updateHeaderStatus();
        }
    });

    // Подписка на статусы сети
    onValue(ref(db, 'status'), (snap) => {
        onlineStatus = snap.exists() ? snap.val() : {};
        buildChatsList();
        if (activeChat && !activeChat.startsWith('group_')) updateHeaderStatus();
    });

    // Подписка на группы
    onValue(ref(db, 'groups'), (snap) => {
        if(snap.exists()) {
            liveGroupData = snap.val();
            buildChatsList();
            if (activeChat && activeChat.startsWith('group_')) {
                updateHeaderStatus();
                const g = liveGroupData[activeChat];
                if (!g || !g.members || !g.members[user]) {
                    activeChat = null;
                    $('messages').innerHTML = `<div class="welcome-notif">Вы были удалены из этой группы.</div>`;
                    $('message-form').style.display = 'none';
                    $('chat-actions-btn').style.display = 'none';
                }
            }
        }
    });

    // Индикатор "печатает..."
    onValue(ref(db, 'typing'), (snap) => {
        typingStatus = snap.exists() ? snap.val() : {};
        renderTypingIndicator();
    });

    // СЛУШАТЕЛЬ СООБЩЕНИЙ ДЛЯ СЧЕТЧИКОВ НЕПРОЧИТАННЫХ И ПОСЛЕДНИХ ТЕКСТОВ
    onValue(ref(db, 'messages'), (snap) => {
        if (!snap.exists()) {
            activeConversations = {};
            buildChatsList();
            return;
        }
        let lastSeenTimestamps = JSON.parse(store.get('last_seen_ts') || '{}');
        let newConversations = {};

        snap.forEach((chatSnap) => {
            const chatId = chatSnap.key;
            
            // Проверка прав доступа к чату
            if (chatId.startsWith('group_')) {
                const g = liveGroupData[chatId];
                if (!g || !g.members || !g.members[user]) return;
            } else {
                const parts = chatId.split('_');
                if (parts.length !== 2 || (parts[0] !== user && parts[1] !== user)) return;
            }

            let lastMsg = null;
            let unreadCount = 0;
            const myLastTS = lastSeenTimestamps[chatId] || 0;

            chatSnap.forEach((msgSnap) => {
                const msg = msgSnap.val();
                lastMsg = msg;
                if (msg.sender !== user && msg.timestamp > myLastTS) {
                    unreadCount++;
                }
            });

            if (lastMsg) {
                newConversations[chatId] = {
                    lastText: lastMsg.type === 'text' ? lastMsg.text : `[${lastMsg.type}]`,
                    timestamp: lastMsg.timestamp,
                    unread: (chatId === activeChat && isWindowFocused) ? 0 : unreadCount
                };
            }
        });
        
        activeConversations = newConversations;
        buildChatsList();
    });
};

// ПОСТРОЕНИЕ СПИСКА ЧАТОВ (СТРОГО: ТОЛЬКО АКТИВНЫЕ ДИАЛОГИ)
const buildChatsList = () => {
    const listEl = $('chats-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    
    // Если сообщений еще нет в базе, выводим заглушку, а не всех подряд
    if (Object.keys(activeConversations).length === 0) {
        listEl.innerHTML = `<div style="color:#7f8c8d; text-align:center; margin-top:20px; font-size:14px;">Нет активных чатов</div>`;
        return;
    }

    let items = [];

    // Перебираем исключительно те chatId, которые есть в активных переписках
    Object.keys(activeConversations).forEach(chatId => {
        const conv = activeConversations[chatId];

        if (chatId.startsWith('group_')) {
            // Групповой чат
            const g = liveGroupData[chatId];
            if (!g || !g.members || !g.members[user]) return;

            items.push({
                id: chatId, 
                title: g.name || 'Группа',
                avatar: g.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(g.name || 'G')}&background=random`,
                lastText: conv.lastText, 
                timestamp: conv.timestamp, 
                unread: conv.unread, 
                isOnline: false
            });
        } else {
            // Личный диалог
            const targetUser = chatId.split('_').find(x => x !== user);
            const target = knownUsers[targetUser];
            
            // Если данные пользователя еще не подгрузились, используем логин как имя
            const cTitle = target ? (target.displayName || targetUser) : targetUser;
            const cAvatar = target?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(cTitle)}`;
            const isOnline = target ? (onlineStatus[targetUser]?.online || target.online || false) : false;

            items.push({
                id: chatId, 
                title: cTitle,
                avatar: cAvatar,
                lastText: conv.lastText, 
                timestamp: conv.timestamp, 
                unread: conv.unread, 
                isOnline: isOnline
            });
        }
    });

    // Сортируем чаты: новые сообщения всегда сверху
    items.sort((a, b) => b.timestamp - a.timestamp);

    // Отрисовка элементов на экран
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = `chat-item ${activeChat === item.id ? 'active' : ''}`;
        div.onclick = () => selectChat(item.id, item.title, item.avatar);

        let timeStr = '';
        if(item.timestamp > 0) {
            const d = new Date(item.timestamp);
            timeStr = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
        }

        div.innerHTML = `
            <img class="chat-avatar" src="${item.avatar}">
            ${item.isOnline ? '<div class="status-dot"></div>' : ''}
            <div class="chat-info">
                <div class="chat-meta">
                    <div class="chat-title">${item.title}</div>
                    <div class="chat-time">${timeStr}</div>
                </div>
                <div class="chat-last-msg">${item.lastText}</div>
            </div>
            ${item.unread > 0 ? `<div class="badge-unread">${item.unread}</div>` : ''}
        `;
        listEl.appendChild(div);
    });
};

// ВЫБОР ЧАТА И ПОДПИСКА НА СООБЩЕНИЯ
const selectChat = (chatId, title, avURL) => {
    activeChat = chatId; activeChatName = title; activeChatAvatar = avURL;

    let lastSeenTimestamps = JSON.parse(store.get('last_seen_ts') || '{}');
    lastSeenTimestamps[chatId] = Date.now();
    store.set('last_seen_ts', JSON.stringify(lastSeenTimestamps));

    if (activeConversations[chatId]) activeConversations[chatId].unread = 0;

    $('app-container').classList.add('chat-active');
    $('active-chat-avatar').src = avURL;
    $('active-chat-avatar').style.display = 'block';
    $('message-form').style.display = 'flex';
    $('chat-actions-btn').style.display = chatId.startsWith('group_') ? 'block' : 'none';

    updateHeaderStatus();
    cleanupMedia();

    if (liveListeners['chat']) liveListeners['chat'](); 
    lastDateStr = null;

    liveListeners['chat'] = onValue(ref(db, `messages/${chatId}`), (snap) => {
        if (activeChat !== chatId) return;
        const msgDiv = $('messages');
        msgDiv.innerHTML = '';
        lastDateStr = null;

        if (snap.exists()) {
            snap.forEach((child) => { renderMessage(child.key, child.val(), chatId); });
            msgDiv.scrollTop = msgDiv.scrollHeight;
        } else {
            msgDiv.innerHTML = `<div class="welcome-notif">История сообщений пуста. Начните общение!</div>`;
        }
    });
};

const updateHeaderStatus = () => {
    if (!activeChat) return;
    $('active-chat-title').innerText = activeChatName;

    if (activeChat.startsWith('group_')) {
        const g = liveGroupData[activeChat];
        if (g && g.members) {
            $('active-chat-status').className = 'status-offline';
            $('active-chat-status').innerText = `${Object.keys(g.members).length} участников`;
        }
    } else {
        const targetUser = activeChat.split('_').find(x => x !== user);
        const isOnline = onlineStatus[targetUser]?.online || knownUsers[targetUser]?.online || false;
        $('active-chat-status').className = isOnline ? 'status-online' : 'status-offline';
        $('active-chat-status').innerText = isOnline ? 'в сети' : 'был(а) недавно';
    }
};

// РЕНДЕРИНГ ОДНОГО СООБЩЕНИЯ
const renderMessage = (msgId, d, chatId) => {
    const msgDiv = $('messages');
    
    if (d.timestamp) {
        const dateStr = new Date(d.timestamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
        if (dateStr !== lastDateStr) {
            lastDateStr = dateStr;
            const divDate = document.createElement('div');
            divDate.className = 'date-divider';
            divDate.innerText = dateStr;
            msgDiv.appendChild(divDate);
        }
    }

    const div = document.createElement('div');
    div.className = `message ${d.sender === user ? 'my-message' : 'other-message'}`;
    div.setAttribute('data-id', msgId);

    if (chatId.startsWith('group_') && d.sender !== user) {
        const aut = document.createElement('span');
        aut.className = 'author'; aut.style.color = d.senderColor || '#5288c1';
        aut.innerText = d.senderDisplayName || d.sender;
        div.appendChild(aut);
    }

    if (d.replyTo) {
        const repDiv = document.createElement('div');
        repDiv.className = 'reply-citation';
        repDiv.innerHTML = `<div class="reply-author">${escapeHTML(d.replyTo.author)}</div><div class="reply-text">${escapeHTML(d.replyTo.text)}</div>`;
        repDiv.onclick = () => {
            const target = document.querySelector(`[data-id="${d.replyTo.id}"]`);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
        div.appendChild(repDiv);
    }

    if (d.forwardFrom) {
        const fwdDiv = document.createElement('div');
        fwdDiv.className = 'fwd-citation'; fwdDiv.innerText = `↩️ Переслано от: ${d.forwardFrom}`;
        div.appendChild(fwdDiv);
    }

    const contentBox = document.createElement('div');
    if (d.type === 'image') {
        contentBox.innerHTML = `<img class="chat-image" src="${d.fileUrl}">`;
        if (d.text) contentBox.innerHTML += `<div class="text" style="margin-top:4px;">${escapeHTML(d.text)}</div>`;
    } else if (d.type === 'voice') {
        contentBox.innerHTML = `<audio src="${d.fileUrl}" controls></audio>`;
    } else if (d.type === 'video') {
        contentBox.innerHTML = `<video src="${d.fileUrl}" class="video-circle" playsinline></video>`;
        setTimeout(() => {
            const v = div.querySelector('video');
            if(v) v.onclick = (e) => { e.stopPropagation(); if(v.paused) { v.play(); v.muted = false; } else v.pause(); };
        }, 50);
    } else {
        contentBox.className = 'text';
        contentBox.innerHTML = d.text ? d.text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color:#64b5f6; text-decoration:underline;">$1</a>') : '';
    }
    div.appendChild(contentBox);

    if (d.reactions) {
        const rRow = document.createElement('div'); rRow.className = 'reactions-row';
        Object.keys(d.reactions).forEach(emoji => {
            const count = Object.keys(d.reactions[emoji] || {}).length;
            if (count > 0) {
                const badge = document.createElement('span'); badge.className = 'reaction-badge'; badge.innerText = `${emoji} ${count}`;
                badge.onclick = (e) => { e.stopPropagation(); toggleReactionDirectly(msgId, emoji, d.reactions[emoji]); };
                rRow.appendChild(badge);
            }
        });
        div.appendChild(rRow);
    }

    const t = new Date(d.timestamp);
    const meta = document.createElement('div'); meta.className = 'msg-meta';
    meta.innerHTML = `<span>${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}</span>`;
    div.appendChild(meta);

    div.addEventListener('contextmenu', (e) => { e.preventDefault(); openContextMenu(e, msgId, d, div); });
    msgDiv.appendChild(div);
};

// ТРИГГЕР СТАТУСА ПЕЧАТИ
let typingTimeout = null;
$('message-input').addEventListener('input', () => {
    if (!activeChat) return;
    updateActionButtonMode($('message-input').value.trim().length > 0 ? 'send' : currentMode);
    update(ref(db, `typing/${activeChat}/${user}`), { displayName: displayName, isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { if(activeChat) update(ref(db, `typing/${activeChat}/${user}`), { isTyping: false }); }, 2000);
});

const renderTypingIndicator = () => {
    const ind = $('typing-indicator');
    if (!activeChat || !typingStatus[activeChat] || !ind) return;
    let typers = [];
    Object.keys(typingStatus[activeChat]).forEach(uKey => {
        if (uKey !== user && typingStatus[activeChat][uKey].isTyping) typers.push(typingStatus[activeChat][uKey].displayName || uKey);
    });
    ind.innerText = typers.length === 1 ? `${typers[0]} печатает...` : (typers.length > 1 ? 'Несколько человек печатают...' : '');
};

// КОНТЕКСТНОЕ МЕНЮ И ВЗАИМОДЕЙСТВИЕ
const openContextMenu = (e, msgId, msgData, el) => {
    contextMenuMessageId = msgId; contextMenuMessageData = msgData; contextMenuElement = el;
    const menu = $('context-menu'); menu.style.display = 'block';
    menu.style.top = `${Math.min(e.pageY, window.innerHeight - 180)}px`;
    menu.style.left = `${Math.min(e.pageX, window.innerWidth - 170)}px`;
    $('ctx-delete-all').style.display = (msgData.sender === user) ? 'block' : 'none';
    setTimeout(() => { window.addEventListener('click', closeContextMenu); }, 20);
};

const closeContextMenu = () => { $('context-menu').style.display = 'none'; window.removeEventListener('click', closeContextMenu); };

let currentReplyPayload = null, currentForwardPayload = null;

$('ctx-reply').onclick = () => {
    currentForwardPayload = null;
    let text = contextMenuMessageData.text || `[${contextMenuMessageData.type}]`;
    currentReplyPayload = { id: contextMenuMessageId, author: contextMenuMessageData.senderDisplayName || contextMenuMessageData.sender, text: text.substring(0,30) };
    showPreviewOverlay(`↩️ Ответ ${currentReplyPayload.author}: "${currentReplyPayload.text}"`);
};

$('ctx-forward').onclick = () => {
    currentReplyPayload = null;
    currentForwardPayload = { sender: contextMenuMessageData.senderDisplayName || contextMenuMessageData.sender, text: contextMenuMessageData.text || null, type: contextMenuMessageData.type, fileUrl: contextMenuMessageData.fileUrl || null };
    showPreviewOverlay(`➡️ Пересылка от ${currentForwardPayload.sender}`);
};

$('ctx-like').onclick = () => { toggleReactionDirectly(contextMenuMessageId, '❤️', contextMenuMessageData.reactions?.['❤️'] || {}); };

const toggleReactionDirectly = async (msgId, emoji, currentUsersList) => {
    let updatedList = { ...currentUsersList };
    if (updatedList[user]) delete updatedList[user]; else updatedList[user] = true;
    await set(ref(db, `messages/${activeChat}/${msgId}/reactions/${emoji}`), updatedList);
};

$('ctx-delete-me').onclick = () => { if (contextMenuElement) contextMenuElement.remove(); };
$('ctx-delete-all').onclick = async () => { if (confirm('Удалить сообщение у всех участников?')) await set(ref(db, `messages/${activeChat}/${contextMenuMessageId}`), null); };

const showPreviewOverlay = (text) => {
    const ov = $('preview-overlay'); ov.innerHTML = ''; ov.classList.remove('hidden');
    ov.innerHTML = `<button class="preview-delete-btn" id="clear-overlay-btn">✕</button><span style="font-size:13px;">${text}</span>`;
    $('clear-overlay-btn').onclick = () => { currentReplyPayload = null; currentForwardPayload = null; ov.classList.add('hidden'); };
};

// ОТПРАВКА СТАНДАРТНЫХ И МЕДИА СООБЩЕНИЙ
$('message-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (localPreviewBlob) { await sendLocalPreview(); return; }

    const t = $('message-input').value.trim();
    if (!t && currentForwardPayload) {
        await finalizeMessageSending({ type: currentForwardPayload.type, text: currentForwardPayload.text, fileUrl: currentForwardPayload.fileUrl, forwardFrom: currentForwardPayload.sender });
        resetInputAfterSend(); return;
    }
    if (!t || !activeChat) return;

    let payload = { type: 'text', text: t };
    if (currentReplyPayload) payload.replyTo = currentReplyPayload;
    if (currentForwardPayload) payload.forwardFrom = currentForwardPayload.sender;

    await finalizeMessageSending(payload);
    resetInputAfterSend();
});

const finalizeMessageSending = async (customFields) => {
    const newMsgRef = push(ref(db, `messages/${activeChat}`));
    await set(newMsgRef, {
        sender: user, senderDisplayName: displayName, senderAvatar: avatar, senderColor: userColor, timestamp: Date.now(), ...customFields
    });
    let lastSeenTimestamps = JSON.parse(store.get('last_seen_ts') || '{}');
    lastSeenTimestamps[activeChat] = Date.now();
    store.set('last_seen_ts', JSON.stringify(lastSeenTimestamps));
};

const resetInputAfterSend = () => {
    $('message-input').value = ''; $('preview-overlay').classList.add('hidden');
    currentReplyPayload = null; currentForwardPayload = null;
    updateActionButtonMode(currentMode);
    if(activeChat) update(ref(db, `typing/${activeChat}/${user}`), { isTyping: false });
};

// ЗАГРУЗКА ИЗОБРАЖЕНИЙ
$('attach-btn').onclick = () => $('file-input').click();
$('file-input').onchange = (e) => {
    const f = e.target.files[0]; if(!f) return;
    resizeAndConvertBase64(f, 800, 800, async (b64Data) => { await finalizeMessageSending({ type: 'image', fileUrl: b64Data, text: '' }); });
    $('file-input').value = '';
};

// СТАБИЛЬНЫЙ РЕКОРДЕР ГОЛОСОВЫХ И КРУЖКОВ
const updateActionButtonMode = (m) => {
    const icon = $('action-btn').querySelector('i'); if (!icon) return;
    icon.className = m === 'send' ? 'fa-solid fa-paper-plane' : (m === 'voice' ? 'fa-solid fa-microphone' : (m === 'video' ? 'fa-solid fa-video' : 'fa-solid fa-square'));
};

const getSupportedMimeType = (m) => {
    const types = m === 'voice' ? ['audio/mp4', 'audio/webm', 'audio/ogg'] : ['video/mp4;codecs=h264', 'video/mp4', 'video/webm'];
    for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; } return '';
};

$('action-btn').onclick = () => {
    if (localPreviewBlob) { sendLocalPreview(); return; }
    if (isRecording && isLocked) { stopRecordingHandler(true); return; }
    if ($('message-input').value.trim().length > 0) { $('message-form').requestSubmit(); return; }
    if (!isRecording) { currentMode = currentMode === 'voice' ? 'video' : 'voice'; updateActionButtonMode(currentMode); }
};

$('action-btn').addEventListener('pointerdown', async (e) => {
    if ($('message-input').value.trim().length > 0 || localPreviewBlob) return;
    e.preventDefault();

    recordStartTime = Date.now(); isRecording = true; isLocked = false; startPointerY = e.clientY;
    $('action-btn').classList.add('recording'); $('recording-overlay').classList.remove('hidden'); $('message-input').classList.add('hidden');

    let secs = 0; $('record-timer').innerText = '00:00';
    timerInterval = setInterval(() => { secs++; $('record-timer').innerText = `${String(Math.floor(secs / 60)).padStart(2,'0')}:${String(secs % 60).padStart(2,'0')}`; }, 1000);

    try {
        const constraints = currentMode === 'voice' ? { audio: true, video: false } : { audio: true, video: { width: 400, height: 400, facingMode: "user" } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!isRecording) { stream.getTracks().forEach(t => t.stop()); return; }
        mediaStream = stream;

        if (currentMode === 'video') { $('camera-preview').srcObject = mediaStream; $('camera-preview').style.display = 'block'; }
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(mediaStream, { mimeType: getSupportedMimeType(currentMode) });
        mediaRecorder.ondataavailable = (ev) => { if (ev.data.size > 0) recordedChunks.push(ev.data); };
        mediaRecorder.onstop = async () => {
            $('camera-preview').style.display = 'none'; $('camera-preview').srcObject = null;
            if (Date.now() - recordStartTime < 600) { cleanupMedia(); return; }
            localPreviewBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
            if (isLocked) showMediaPreviewUI(); else await sendLocalPreview();
        };
        mediaRecorder.start();
    } catch (err) { alert('Ошибка доступа к микрофону/камере.'); cleanupMedia(); }
});

window.addEventListener('pointermove', (e) => {
    if (!isRecording || isLocked) return;
    if (startPointerY - e.clientY > 60) {
        isLocked = true; $('action-btn').classList.remove('recording'); $('action-btn').classList.add('locked-recording');
        updateActionButtonMode('stop'); document.querySelector('.swipe-hint').innerText = 'Фиксация записи';
    }
});

const stopRecordingHandler = (forcedByLockClick = false) => {
    if (!isRecording) return; if (isLocked && !forcedByLockClick) return;
    isRecording = false; clearInterval(timerInterval); $('recording-overlay').classList.add('hidden');
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
};

window.addEventListener('pointerup', () => stopRecordingHandler(false));

const showMediaPreviewUI = () => {
    const ov = $('preview-overlay'); ov.innerHTML = ''; ov.classList.remove('hidden');
    let node = document.createElement(currentMode === 'voice' ? 'audio' : 'video');
    if (currentMode === 'video') node.className = 'video-circle-preview';
    node.controls = true; node.src = URL.createObjectURL(localPreviewBlob);
    const delBtn = document.createElement('button'); delBtn.className = 'preview-delete-btn'; delBtn.innerHTML = '✕'; delBtn.onclick = cleanupMedia;
    ov.appendChild(delBtn); ov.appendChild(node); updateActionButtonMode('send');
};

const sendLocalPreview = async () => {
    if (!localPreviewBlob) return;
    const blob = localPreviewBlob, mode = currentMode;
    cleanupMedia();
    const reader = new FileReader();
    reader.onloadend = async () => { await finalizeMessageSending({ type: mode, fileUrl: reader.result }); };
    reader.readAsDataURL(blob);
};

const cleanupMedia = () => {
    isRecording = false; isLocked = false; localPreviewBlob = null; clearInterval(timerInterval);
    $('action-btn').className = ''; $('recording-overlay').classList.add('hidden'); $('preview-overlay').classList.add('hidden');
    $('message-input').classList.remove('hidden'); document.querySelector('.swipe-hint').innerText = '▲ Смахните вверх для фиксации';
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    updateActionButtonMode(currentMode);
};

// БУРГЕР-МЕНЮ И НАСТРОЙКИ ПРОФИЛЯ
const toggleBurgerMenu = (open) => {
    const burger = $('burger-menu'), content = burger.querySelector('.burger-content');
    if (open) { burger.style.display = 'block'; setTimeout(() => { content.style.left = '0'; }, 10); } 
    else { content.style.left = '-260px'; setTimeout(() => { burger.style.display = 'none'; }, 250); }
};

$('burger-menu-btn').onclick = () => toggleBurgerMenu(true);
$('burger-menu').onclick = (e) => { if(e.target === $('burger-menu')) toggleBurgerMenu(false); };

$('menu-profile').onclick = () => {
    toggleBurgerMenu(false); $('modal-avatar-preview').src = avatar;
    $('modal-display-name-input').value = displayName; $('modal-color-input').value = userColor;
    $('profile-modal').style.display = 'flex';
};

$('profile-cancel-btn').onclick = () => $('profile-modal').style.display = 'none';
$('modal-avatar-preview').onclick = () => $('modal-avatar-file').click();
$('modal-avatar-file').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    resizeAndConvertBase64(f, 150, 150, (b64) => { modalAvatarBase64 = b64; $('modal-avatar-preview').src = b64; });
};

$('profile-save-btn').onclick = async () => {
    const newDN = $('modal-display-name-input').value.trim(); if (!newDN) return alert('Имя не может быть пустым');
    let updatedAv = modalAvatarBase64 || avatar;
    await update(ref(db, `users/${user}`), { displayName: newDN, avatar: updatedAv, userColor: $('modal-color-input').value });
    displayName = newDN; avatar = updatedAv; userColor = $('modal-color-input').value;
    store.set('c_dn', displayName); store.set('c_av', avatar); store.set('c_co', userColor);
    $('burger-my-name').innerText = displayName; $('burger-my-avatar').src = avatar;
    $('profile-modal').style.display = 'none'; modalAvatarBase64 = null;
};

// СОЗДАНИЕ ГРУППЫ
$('menu-create-group').onclick = () => {
    toggleBurgerMenu(false); const listEl = $('group-members-list'); listEl.innerHTML = ''; groupAvatarBase64 = null;
    $('group-preview').src = 'https://ui-avatars.com/api/?name=G&background=248bcf'; $('group-name-input').value = '';
    Object.keys(knownUsers).forEach(uKey => {
        if (uKey === user) return;
        const d = document.createElement('div'); d.style.margin = '6px 0';
        d.innerHTML = `<input type="checkbox" class="group-member-cb" value="${uKey}" id="cb_${uKey}" style="width:auto; margin-right:8px;"><label for="cb_${uKey}" style="color:white; font-size:14px; cursor:pointer;">${knownUsers[uKey].displayName || uKey}</label>`;
        listEl.appendChild(d);
    });
    $('group-modal').style.display = 'flex';
};

$('group-cancel-btn').onclick = () => $('group-modal').style.display = 'none';
$('group-avatar-file').onchange = (e) => {
    const f = e.target.files[0]; if(!f) return;
    resizeAndConvertBase64(f, 150, 150, (b64) => { groupAvatarBase64 = b64; $('group-preview').src = b64; });
};

$('group-create-submit-btn').onclick = async () => {
    const gName = $('group-name-input').value.trim(); if (!gName) return alert('Введите название!');
    let membersMap = {}; membersMap[user] = true;
    document.querySelectorAll('.group-member-cb:checked').forEach(cb => { membersMap[cb.value] = true; });
    const newGroupId = 'group_' + Date.now();
    await set(ref(db, `groups/${newGroupId}`), { name: gName, avatar: groupAvatarBase64 || null, creator: user, members: membersMap });
    $('group-modal').style.display = 'none';
};

// ИНФОРМАЦИЯ О ГРУППЕ / МОДЕРАЦИЯ
$('chat-actions-btn').onclick = () => {
    if (!activeChat || !activeChat.startsWith('group_')) return;
    const g = liveGroupData[activeChat]; if (!g) return;
    $('members-modal-title').innerText = `Участники: ${g.name}`;
    const mList = $('current-members-list'); mList.innerHTML = '';
    const isCreator = (g.creator === user);

    Object.keys(g.members || {}).forEach(mKey => {
        const div = document.createElement('div'); div.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin:5px 0;';
        div.innerHTML = `<span style="color:white; font-size:14px;">${knownUsers[mKey]?.displayName || mKey}${g.creator === mKey ? ' (Создатель)' : ''}</span>`;
        if (isCreator && mKey !== user) {
            const kickBtn = document.createElement('button'); kickBtn.innerText = 'Исключить'; kickBtn.style.cssText = 'background:#ef5350; padding:2px 6px; font-size:12px; border:none; border-radius:4px; color:white; cursor:pointer;';
            kickBtn.onclick = async () => {
                if (confirm(`Исключить ${knownUsers[mKey]?.displayName || mKey}?`)) {
                    let updMembers = { ...g.members }; delete updMembers[mKey];
                    await set(ref(db, `groups/${activeChat}/members`), updMembers); div.remove();
                }
            };
            div.appendChild(kickBtn);
        }
        mList.appendChild(div);
    });

    if (isCreator) {
        const addAvail = $('add-members-available'); addAvail.innerHTML = '';
        Object.keys(knownUsers).forEach(uKey => {
            if (!g.members[uKey]) {
                const row = document.createElement('div'); row.style.margin = '4px 0';
                row.innerHTML = `<input type="checkbox" class="add-m-cb" value="${uKey}" id="am_cb_${uKey}" style="width:auto; margin-right:8px;"><label for="am_cb_${uKey}" style="color:white; font-size:13px; cursor:pointer;">${knownUsers[uKey].displayName || uKey}</label>`;
                addAvail.appendChild(row);
            }
        });
        $('add-member-zone').style.display = 'block';
    } else $('add-member-zone').style.display = 'none';
    $('members-modal').style.display = 'flex';
};

$('members-close-btn').onclick = () => { $('members-modal').style.display = 'none'; };
$('add-member-submit-btn').onclick = async () => {
    const g = liveGroupData[activeChat]; let updMembers = { ...g.members };
    document.querySelectorAll('.add-m-cb:checked').forEach(cb => { updMembers[cb.value] = true; });
    await set(ref(db, `groups/${activeChat}/members`), updMembers); $('members-modal').style.display = 'none';
};

$('back-to-sidebar').onclick = () => { $('app-container').classList.remove('chat-active'); activeChat = null; };

// ПОИСК ПО ЧАТАМ
$('search-input').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.chat-item').forEach(item => {
        const title = item.querySelector('.chat-title').innerText.toLowerCase();
        const text = item.querySelector('.chat-last-msg').innerText.toLowerCase();
        item.style.display = (title.includes(query) || text.includes(query)) ? 'flex' : 'none';
    });
});

// АВТОРИЗАЦИЯ И СОХРАНЕНИЕ
let loginAvatarBase64 = null;
$('avatar-file').onchange = (e) => {
    const f = e.target.files[0]; if(!f) return;
    resizeAndConvertBase64(f, 150, 150, (b64) => { loginAvatarBase64 = b64; $('login-preview').src = b64; });
};

$('login-btn').onclick = async () => {
    const u = $('username-input').value.trim().toLowerCase(), p = $('password-input').value.trim();
    if (!u || !p) return alert('Заполните все поля!');
    if (/[.#$\[\]]/.test(u)) return alert('Недопустимые символы в логине!');

    if (!isNetworkOnline) {
        if (store.get('c_nk') === u && simpleDecode(store.get('c_pv')) === p) {
            user = u; displayName = store.get('c_dn') || u; avatar = store.get('c_av'); userColor = store.get('c_co') || '#5288c1';
            initApp(); return;
        } else return alert('Данные в офлайне не совпадают!');
    }

    const snap = await get(ref(db, `users/${u}`));
    if (snap.exists()) {
        const d = snap.val(); if (d.password !== p) return alert('Неверный пароль!');
        user = u; displayName = d.displayName || u; avatar = d.avatar; userColor = d.userColor || '#5288c1';
    } else {
        user = u; displayName = u; userColor = '#5288c1';
        avatar = loginAvatarBase64 || `https://ui-avatars.com/api/?name=${encodeURIComponent(u)}&background=random`;
        await set(ref(db, `users/${u}`), { username: u, displayName: u, avatar: avatar, password: p, userColor: '#5288c1', online: true });
    }

    if ($('remember-me').checked) {
        store.set('c_nk', user); store.set('c_pv', simpleHash(p)); store.set('c_dn', displayName); store.set('c_av', avatar); store.set('c_co', userColor);
    }
    initApp();
};

$('menu-logout').onclick = () => {
    if (user && isNetworkOnline) update(ref(db, `users/${user}`), { online: false });
    store.clear(); location.reload();
};

function escapeHTML(str) { return str ? str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])) : ''; }

// КЭШ ПРИ СТАРТЕ
const cachedUser = store.get('c_nk');
if (cachedUser) {
    user = cachedUser; displayName = store.get('c_dn') || cachedUser;
    avatar = store.get('c_av'); userColor = store.get('c_co') || '#5288c1';
    initApp();
}
