import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getDatabase, ref, onValue, set, update, get, push, onDisconnect } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCtdqpLLsbOlvQlXG_EeQUZlr5qo57poI",
    authDomain: "messenger-2e22b.firebaseapp.com",
    databaseURL: "https://messenger-2e22b-default-rtdb.firebaseio.com",
    projectId: "messenger-2e22b"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- СОСТОЯНИЕ ПРИЛОЖЕНИЯ ---
let user = null, displayName = null, avatar = null, userColor = '#5288c1';
let mode = 'sidebar', activeChat = null, activeChatName = '', activeChatAvatar = '';

let knownUsers = {}, activeConversations = {}, activeGroups = {}, onlineStatus = {};
let groupAvatarBase64 = null;
let isNetworkOnline = true;

// Контекстное меню
let selectedMsgId = null, selectedMsgText = null, selectedMsgSender = null;
let replyToId = null, replyToName = null, replyToText = null;

// Запись медиа (Telegram Style)
let recordingMode = 'audio'; // 'audio' или 'video'
let isRecording = false;
let pressTimer = null;
let recordInterval = null;
let recordSeconds = 0;
let mediaRecorder = null;
let mediaChunks = [];
let activeStream = null;

const $ = id => document.getElementById(id);
const safeListen = (id, ev, cb) => { const el = $(id); if(el) el.addEventListener(ev, cb); };

// Очистка юзернейма
function sanitizeUser(u) {
    if(!u) return '';
    return u.trim().toLowerCase().replace(/@/g, '').replace(/[^a-z0-9_]/g, '');
}

// --- ИНИЦИАЛИЗАЦИЯ И СЕТЬ ---
onValue(ref(db, '.info/connected'), (snap) => {
    isNetworkOnline = snap.val() === true;
    updateChatSubtitle();
});

async function login() {
    let uInput = sanitizeUser($('username-input').value);
    let pInput = $('password-input').value.trim();
    if(!uInput || !pInput) return alert('Заполните логин и пароль!');
    if(uInput === 'undefined' || uInput === 'null' || uInput === 'system') return alert('Недопустимое имя!');

    $('login-submit-btn').disabled = true;
    const snap = await get(ref(db, `users/${uInput}`));
    const previewSrc = $('login-preview').src;
    const finalAv = (previewSrc && previewSrc.startsWith('data:')) ? previewSrc : `https://ui-avatars.com/api/?name=${encodeURIComponent(uInput)}&background=random`;

    if (snap.exists()) {
        const data = snap.val();
        if (data.password !== pInput) {
            alert('Неверный пароль!');
            $('login-submit-btn').disabled = false;
            return;
        }
        user = uInput;
        displayName = data.displayName || uInput;
        avatar = data.avatar || finalAv;
        userColor = data.userColor || '#5288c1';
    } else {
        user = uInput;
        displayName = uInput;
        avatar = finalAv;
        await set(ref(db, `users/${user}`), { username: user, displayName: user, avatar: avatar, password: pInput, userColor: userColor, online: true });
    }

    // Предполагается, что в оригинале был чекбокс remember-me
    // localStorage.setItem('c_nk', user);
    // localStorage.setItem('c_pv', pInput);
    
    initApp();
}

function initApp() {
    $('login-screen').style.display = 'none';
    $('my-name').innerText = displayName;
    $('my-usertag').innerText = '@' + user;
    $('my-avatar').src = avatar;

    const myOnlineRef = ref(db, `users/${user}/online`);
    set(myOnlineRef, true);
    onDisconnect(myOnlineRef).set(false);

    // Грузим юзеров, фильтруем багованные
    onValue(ref(db, 'users'), snap => {
        const data = snap.val() || {};
        knownUsers = {};
        Object.keys(data).forEach(k => {
            if (k && k !== 'undefined' && k !== 'null') {
                knownUsers[k] = data[k];
                onlineStatus[k] = data[k].online || false;
            }
        });
        renderSidebar();
    });

    // Грузим диалоги (только если есть сообщения)
    onValue(ref(db, 'messages'), snap => {
        let tempConvs = {};
        snap.forEach(room => {
            const rKey = room.key;
            if (rKey.includes('_') && rKey.includes(user)) {
                const parts = rKey.split('_');
                const targetUser = parts[0] === user ? parts[1] : parts[0];
                
                if (targetUser && targetUser !== 'undefined' && knownUsers[targetUser]) {
                    let unread = 0; let lastMsg = null;
                    room.forEach(msg => {
                        const m = msg.val();
                        if (m.sender !== user && !m.read) unread++;
                        lastMsg = m;
                    });
                    tempConvs[targetUser] = { user: knownUsers[targetUser], unreadCount: unread, lastMsg: lastMsg, timestamp: lastMsg ? lastMsg.timestamp : 0 };
                }
            }
        });
        activeConversations = tempConvs;
        renderSidebar();
    });
// Грузим группы
    onValue(ref(db, 'groups'), snap => {
        let tempGroups = {};
        snap.forEach(g => {
            const gData = g.val();
            if (gData && gData.members && gData.members[user]) {
                tempGroups[g.key] = gData;
                // Вешаем локальный слушатель сообщений группы для LastMsg
                onValue(ref(db, `messages/${g.key}`), mSnap => {
                    let unread = 0; let lastMsg = null;
                    mSnap.forEach(msg => {
                        const m = msg.val();
                        if (m.sender !== user && !m.read) unread++;
                        lastMsg = m;
                    });
                    if (activeGroups[g.key]) {
                        activeGroups[g.key].unreadCount = unread;
                        activeGroups[g.key].lastMsg = lastMsg;
                        activeGroups[g.key].timestamp = lastMsg ? lastMsg.timestamp : 0;
                        renderSidebar();
                    }
                });
            }
        });
        activeGroups = tempGroups;
        renderSidebar();
        applyChatBackground();
    });
}

// --- РЕНДЕР САЙДБАРА ---
function renderSidebar() {
    const list = $('user-list');
    list.innerHTML = '';
    const searchVal = sanitizeUser($('search-user-input').value);

    let items = [];
    Object.values(activeConversations).forEach(c => { items.push({ type: 'dm', id: c.user.username, name: c.user.displayName, av: c.user.avatar, unread: c.unreadCount, ts: c.timestamp, lastMsg: c.lastMsg, obj: c.user }); });
    Object.keys(activeGroups).forEach(gld => { const g = activeGroups[gld]; items.push({ type: 'group', id: gld, name: g.name, av: g.avatar, unread: g.unreadCount||0, ts: g.timestamp||0, lastMsg: g.lastMsg, obj: g }); });

    items.sort((a,b) => b.ts - a.ts);

    if (searchVal) {
        items = items.filter(i => i.name.toLowerCase().includes(searchVal) || i.id.toLowerCase().includes(searchVal));
        
        // Если ищем глобально и юзер есть в базе
        if (knownUsers[searchVal] && searchVal !== user && !activeConversations[searchVal]) {
            items.push({ type: 'dm', id: searchVal, name: knownUsers[searchVal].displayName, av: knownUsers[searchVal].avatar, unread: 0, ts: 0, lastMsg: null, obj: knownUsers[searchVal] });
        }
    }

    if (items.length === 0) {
        list.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-sub); font-size:13px;">Диалогов нет.<br>Введите никнейм в поиск.</div>`;
        return;
    }

    items.forEach(i => {
        let statusText = i.type === 'group' ? `${Object.keys(i.obj.members||{}).length} участников` : (onlineStatus[i.id] ? 'в сети' : 'офлайн');
        let statusClass = (i.type === 'group' || onlineStatus[i.id]) ? 'on' : '';
        
        let lastTxt = "";
        if (i.lastMsg) {
            let prefix = i.lastMsg.sender === user ? 'Вы: ' : '';
            let content = i.lastMsg.type === 'text' ? i.lastMsg.text : '[Медиа]';
            lastTxt = prefix + content;
        }

        list.innerHTML += `
            <div class="contact" onclick="window.openChat('${i.id}', '${i.name.replace(/'/g,"")}', '${i.av}')">
                <img src="${i.av || 'https://ui-avatars.com/api/?name=U'}">
                <div class="c-info">
                    <div class="c-name">${i.name}</div>
                    <div class="c-status ${statusClass}">${lastTxt || statusText}</div>
                </div>
                ${i.unread > 0 ? `<div class="badge">${i.unread}</div>` : ''}
            </div>
        `;
    });
}

$('search-user-input').addEventListener('input', renderSidebar);
// --- ЛОГИКА ЧАТА ---
window.openChat = function(id, name, av) {
    activeChat = id;
    activeChatName = name;
    activeChatAvatar = av;
    mode = id.startsWith('group_') ? id : [user, id].sort().join('_');

    $('chat-avatar').src = av;
    $('chat-avatar').style.display = 'block';
    $('chat-title').innerText = name;
    $('chat-settings-trigger').style.display = 'block';

    if (window.innerWidth <= 768) $('sidebar').classList.add('hidden');

    // Подписка на печать
    if (window.unsubTyping) window.unsubTyping();
    window.unsubTyping = onValue(ref(db, `typing/${mode}`), snap => {
        const data = snap.val() || {};
        let typists = [];
        for (let u in data) if (u !== user && data[u]) typists.push(knownUsers[u]?.displayName || u);
        updateChatSubtitle(typists);
    });

    applyChatBackground();
    loadMsgs();
};

function updateChatSubtitle(typists = []) {
    const sub = $('chat-subtitle');
    if (!sub || !activeChat) return;

    if (typists.length > 0) {
        sub.innerText = `${typists.join(', ')} печатает...`;
        sub.style.color = '#31b545';
        return;
    }

    sub.style.color = 'var(--text-sub)';
    if (!isNetworkOnline) { sub.innerText = 'Ожидание сети...'; sub.style.color = '#e53935'; return; }

    if (activeChat.startsWith('group_')) {
        const g = activeGroups[activeChat];
        sub.innerText = g ? `${Object.keys(g.members||{}).length} участников` : '';
    } else {
        sub.innerText = onlineStatus[activeChat] ? 'в сети' : 'был(а) недавно';
        if (onlineStatus[activeChat]) sub.style.color = 'var(--accent-color)';
    }
}

function applyChatBackground() {
    const msgArea = $('messages');
    if (!activeChat) return;
    let bg = localStorage.getItem('bg_' + mode); // Личный
    
    if (activeChat.startsWith('group_')) {
        if (activeGroups[activeChat]?.background) bg = activeGroups[activeChat].background; // Принудительный фон группы
    }
    
    msgArea.style.backgroundImage = bg ? `url(${bg})` : 'none';
}

function loadMsgs() {
    if (window.unsubMsgs) window.unsubMsgs();
    window.unsubMsgs = onValue(ref(db, `messages/${mode}`), snap => {
        const box = $('messages');
        box.innerHTML = '';
        let lastDate = "";

        snap.forEach(child => {
            const d = child.val();
            const key = child.key;
            if (d.sender !== user && !d.read) update(ref(db, `messages/${mode}/${key}`), { read: true });

            let dStr = new Date(d.timestamp).toLocaleDateString('ru');
            if (dStr !== lastDate) {
                box.innerHTML += `<div class="dt-sep">${dStr}</div>`;
                lastDate = dStr;
            }

            const isMe = d.sender === user;
            const timeStr = new Date(d.timestamp).toLocaleTimeString('ru', {hour:'2-digit', minute:'2-digit'});
            
            let content = d.text;
            if (d.type === 'image') content = `<img src="${d.mediaUrl}" class="chat-image">`;
            if (d.type === 'audio') content = `<div class="voice-player"><button class="voice-play-btn" onclick="window.playAudio('${d.mediaUrl}')"><i class="fa-solid fa-play"></i></button><span style="font-size:12px;">Голосовое</span></div>`;
            if (d.type === 'video') content = `<video src="${d.mediaUrl}" class="video-circle" controls playsinline webkit-playsinline></video>`;
            if (d.type === 'bg_proposal') {
                content = `<div style="font-size:12px; font-style:italic;">Предложение фона:</div><img src="${d.proposalBg}" style="max-width:120px; border-radius:8px;"><br>`;
                if (d.status === 'accepted') content += `<b style="color:#31b545; font-size:12px;">Принято</b>`;
                else if (d.status === 'rejected') content += `<b style="color:#e53935; font-size:12px;">Отклонено</b>`;
                else if (!isMe) content += `<button onclick="window.resolveBg('${key}', true)" style="background:#31b545; padding:4px; font-size:11px; border:none; border-radius:4px; color:white; margin-top:4px;">Принять</button>`;
            }

            let replyHTML = d.replyToId ? `<div class="reply-sub-block"><div class="reply-sub-sender">${d.replyToName}</div><div class="reply-sub-text">${d.replyToText}</div></div>` : '';
            let nameHTML = (!isMe && activeChat.startsWith('group_')) ? `<div class="msg-name" style="color:${d.senderColor}">${d.senderName}</div>` : '';
            let avatarHTML = (!isMe && activeChat.startsWith('group_')) ? `<img src="${knownUsers[d.sender]?.avatar||''}" class="msg-sender-avatar" onclick="window.openDirect('${d.sender}')">` : '';

            box.innerHTML += `
                <div class="msg-wrapper ${isMe?'me':'them'}" data-id="${key}" data-txt="${d.type==='text'?d.text:'Медиа'}" data-sender="${d.sender}">
                    ${avatarHTML}
                    <div class="msg">
                        ${nameHTML}
                        ${replyHTML}
                        ${content}
                        <div class="msg-meta"><span>${timeStr}</span><span class="ticks">${isMe ? (d.read?'✓✓':'✓') : ''}</span></div>
                    </div>
                </div>
            `;
        });
        box.scrollTop = box.scrollHeight;
        
        // Навешиваем меню
        document.querySelectorAll('.msg-wrapper').forEach(el => {
            el.oncontextmenu = (e) => { e.preventDefault(); window.showMenu(e, el); };
            el.addEventListener('touchstart', e => { pressTimer = setTimeout(() => window.showMenu(e.touches[0], el), 500); }, {passive:true});
            el.addEventListener('touchend', () => clearTimeout(pressTimer));
            el.addEventListener('touchmove', () => clearTimeout(pressTimer));
        });
    });
}

window.openDirect = function(u) {
    if(u === user) return;
    $('#members-modal').style.display = 'none';
    const ud = knownUsers[u];
    window.openChat(u, ud.displayName, ud.avatar);
};

window.playAudio = function(url) {
    if (window.currAudio) window.currAudio.pause();
    window.currAudio = new Audio(url);
    window.currAudio.play();
};

window.resolveBg = async function(msgId, accept) {
    await update(ref(db, `messages/${mode}/${msgId}`), { status: accept ? 'accepted' : 'rejected' });
    if (accept) {
        const snap = await get(ref(db, `messages/${mode}/${msgId}`));
        localStorage.setItem('bg_' + mode, snap.val().proposalBg);
        applyChatBackground();
    }
};

function sendMessage(text, type = 'text', mediaUrl = null) {
    if (type === 'text' && !text) return;
    const payload = {
        sender: user, senderName: displayName, senderColor: userColor,
        type: type, text: text, mediaUrl: mediaUrl, timestamp: Date.now(), read: false
    };
    if (replyToId) { payload.replyToId = replyToId; payload.replyToName = replyToName; payload.replyToText = replyToText; cancelReply(); }
    push(ref(db, `messages/${mode}`), payload);
    if(type === 'text') $('#message-input').value = '';
    toggleInputButtons();
}

// --- ВВОД, КНОПКИ И МЕДИА ЗАПИСИ ---
$('#message-input').addEventListener('input', () => {
    toggleInputButtons();
    set(ref(db, `typing/${mode}/${user}`), true);
    clearTimeout(window.typeT);
    window.typeT = setTimeout(() => set(ref(db, `typing/${mode}/${user}`), null), 1500);
});

function toggleInputButtons() {
    const hasText = $('#message-input').value.trim().length > 0;
    $('#action-btn').style.display = hasText ? 'none' : 'flex';
    $('#send-btn').style.display = hasText ? 'flex' : 'none';
}

$('#message-form').addEventListener('submit', e => { e.preventDefault(); sendMessage($('#message-input').value.trim()); });

// ЛОГИКА КНОПКИ МИКРОФОНА/КАМЕРЫ (КАК В ТГ)
const actionBtn = $('#action-btn');
let recordTimeout = null;

actionBtn.addEventListener('pointerdown', e => {
    if ($('#message-input').value.trim().length > 0) return;
    e.preventDefault();
    // Ждем 300мс перед стартом записи, чтобы отличить от клика
    recordTimeout = setTimeout(() => {
        startMediaRecord();
    }, 300);
});

actionBtn.addEventListener('pointerup', e => {
    e.preventDefault();
    clearTimeout(recordTimeout);
    if (isRecording) {
        stopMediaRecord(true); // Сохранить и отправить
    } else {
        // Это был короткий клик -> Переключаем режим
        recordingMode = recordingMode === 'audio' ? 'video' : 'audio';
        actionBtn.innerHTML = recordingMode === 'audio' ? '<i class="fa-solid fa-microphone"></i>' : '<i class="fa-solid fa-video"></i>';
    }
});

actionBtn.addEventListener('pointerleave', () => {
    clearTimeout(recordTimeout);
    if(isRecording) stopMediaRecord(false); // Отмена при уводе пальца
});

async function startMediaRecord() {
    isRecording = true;
    recordSeconds = 0;
    $('#message-input').style.display = 'none';
    $('#attach-btn').style.display = 'none';
    $('#recording-status').style.display = 'flex';
    $('#recording-text').innerText = recordingMode === 'audio' ? 'Запись аудио...' : 'Запись видео...';
    $('#recording-timer').innerText = '0:00';
    actionBtn.classList.add('recording-mode');
    $('#input-container-block').classList.add('recording-active');

    recordInterval = setInterval(() => {
        recordSeconds++;
        let m = Math.floor(recordSeconds / 60);
        let s = recordSeconds % 60;
        $('#recording-timer').innerText = `${m}:${s<10?'0':''}${s}`;
    }, 1000);

    let constraints = recordingMode === 'audio' ? { audio: true } : { audio: true, video: { facingMode: 'user' } };
    
    try {
        activeStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (recordingMode === 'video') {
            $('#camera-preview').srcObject = activeStream;
            $('#camera-preview').style.display = 'block';
        }
        
        // Apple Safari Fix
        let mime = recordingMode === 'audio' ? 'audio/webm' : 'video/webm';
        if (recordingMode === 'audio' && MediaRecorder.isTypeSupported('audio/mp4')) mime = 'audio/mp4';
        if (recordingMode === 'video' && MediaRecorder.isTypeSupported('video/mp4')) mime = 'video/mp4';

        mediaRecorder = new MediaRecorder(activeStream, { mimeType: mime });
        mediaChunks = [];
        mediaRecorder.ondataavailable = e => { if(e.data.size > 0) mediaChunks.push(e.data); };
        mediaRecorder.start();

    } catch (err) {
        alert("Ошибка доступа к медиа: " + err.message);
        stopMediaRecord(false);
    }
}

function stopMediaRecord(shouldSave) {
    isRecording = false;
    clearInterval(recordInterval);
    $('#message-input').style.display = 'block';
    $('#attach-btn').style.display = 'flex';
    $('#recording-status').style.display = 'none';
    actionBtn.classList.remove('recording-mode');
    $('#input-container-block').classList.remove('recording-active');
    
    if ($('#camera-preview').srcObject) {
        $('#camera-preview').srcObject.getTracks().forEach(t => t.stop());
        $('#camera-preview').srcObject = null;
        $('#camera-preview').style.display = 'none';
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.onstop = () => {
            if (shouldSave && recordSeconds >= 1) {
                const blob = new Blob(mediaChunks, { type: mediaRecorder.mimeType });
                const r = new FileReader();
                r.onload = () => sendMessage('', recordingMode, r.result);
                r.readAsDataURL(blob);
            }
        };
        mediaRecorder.stop();
    }
    if (activeStream) activeStream.getTracks().forEach(t => t.stop());
}
// --- КОНТЕКСТНОЕ МЕНЮ И ШАПКА ---
window.showMenu = function(e, el) {
    selectedMsgId = el.getAttribute('data-id');
    selectedMsgText = el.getAttribute('data-txt');
    selectedMsgSender = el.getAttribute('data-sender');

    const menu = $('#context-menu');
    menu.style.display = 'flex';
    menu.style.left = (e.clientX || e.pageX) + 'px';
    menu.style.top = (e.clientY || e.pageY) + 'px';

    $('#ctx-delete-all').style.display = (selectedMsgSender === user) ? 'flex' : 'none';
};

document.addEventListener('click', e => { if(!e.target.closest('#context-menu') && !e.target.closest('.msg-wrapper')) $('#context-menu').style.display = 'none'; });

safeListen('ctx-reply', 'click', () => {
    replyToId = selectedMsgId; replyToText = selectedMsgText; replyToName = knownUsers[selectedMsgSender]?.displayName || 'User';
    $('#reply-preview-text').innerText = replyToText;
    $('#reply-preview-bar').style.display = 'flex';
    $('#context-menu').style.display = 'none';
});

safeListen('reply-close-btn', 'click', cancelReply);
function cancelReply() { replyToId=null; replyToText=null; replyToName=null; $('#reply-preview-bar').style.display='none'; }

safeListen('ctx-delete-me', 'click', () => { set(ref(db, `messages/${mode}/${selectedMsgId}`), null); $('#context-menu').style.display='none'; });
safeListen('ctx-delete-all', 'click', () => { set(ref(db, `messages/${mode}/${selectedMsgId}`), null); $('#context-menu').style.display='none'; });

// Шапка и настройки чата
safeListen('chat-header-clickable', 'click', e => {
    if (e.target.closest('#back-btn') || !activeChat) return;
    
    if (activeChat.startsWith('group_')) {
        const g = activeGroups[activeChat];
        if (!g) return;
        $('#members-modal-title').innerText = "О беседе";
        $('#edit-group-name-input').value = g.name;
        
        $('#group-admin-zone').style.display = g.createdBy === user ? 'block' : 'none';
        $('#group-member-zone').style.display = g.createdBy === user ? 'none' : 'block';
        $('#dm-settings-zone').style.display = 'none';
        $('#members-list-container').style.display = 'block';

        const mList = $('#members-list');
        mList.innerHTML = '';
        Object.keys(g.members||{}).forEach(uid => {
            const ud = knownUsers[uid] || { displayName: uid };
            const isAdm = uid === g.createdBy ? '👑 Создатель' : 'Участник';
            const kickBtn = (g.createdBy === user && uid !== user) ? `<button class="danger-btn" onclick="window.kickUser('${uid}')">Исключить</button>` : '';
            
            mList.innerHTML += `
                <div class="list-item" onclick="window.openDirect('${uid}')">
                    <img src="${ud.avatar || 'https://ui-avatars.com/api/?name=U'}">
                    <div class="list-item-info">
                        <div style="font-weight:bold;">${ud.displayName}</div>
                        <div style="font-size:11px; color:var(--text-sub)">${isAdm}</div>
                    </div>
                    <div onclick="event.stopPropagation()">${kickBtn}</div>
                </div>
            `;
        });
        $('#members-modal').style.display = 'flex';
    } else {
        $('#members-modal-title').innerText = "Настройки чата";
        $('#group-admin-zone').style.display = 'none';
        $('#group-member-zone').style.display = 'none';
        $('#members-list-container').style.display = 'none';
        $('#dm-settings-zone').style.display = 'block';
        $('#reset-local-bg-btn').style.display = localStorage.getItem('bg_'+mode) ? 'block' : 'none';
        $('#members-modal').style.display = 'flex';
    }
});

window.kickUser = async function(uid) {
    if(confirm("Удалить пользователя?")) {
        await set(ref(db, `groups/${activeChat}/members/${uid}`), null);
        $('#members-modal').style.display = 'none';
    }
};

safeListen('members-close-btn', 'click', () => $('#members-modal').style.display = 'none');
// Фоны
safeListen('local-bg-file', 'change', e => {
    const r = new FileReader();
    r.onload = () => { localStorage.setItem('bg_'+mode, r.result); applyChatBackground(); $('#members-modal').style.display='none'; };
    r.readAsDataURL(e.target.files[0]);
});
safeListen('reset-local-bg-btn', 'click', () => { localStorage.removeItem('bg_'+mode); applyChatBackground(); $('#members-modal').style.display='none'; });
safeListen('shared-bg-file', 'change', e => {
    const r = new FileReader();
    r.onload = () => { push(ref(db, `messages/${mode}`), { sender: user, type:'bg_proposal', proposalBg: r.result, status:'pending', timestamp: Date.now() }); $('#members-modal').style.display='none'; alert("Предложение отправлено"); };
    r.readAsDataURL(e.target.files[0]);
});
safeListen('edit-group-bg-file', 'change', e => {
    const r = new FileReader();
    r.onload = () => { update(ref(db, `groups/${activeChat}`), { background: r.result }); $('#members-modal').style.display='none'; alert("Фон группы изменен"); };
    r.readAsDataURL(e.target.files[0]);
});
safeListen('edit-group-name-input', 'change', e => { update(ref(db, `groups/${activeChat}`), { name: e.target.value.trim() }); });

// ДОБАВЛЕНИЕ ЛЮДЕЙ В БЕСЕДУ
safeListen('add-member-trigger-btn', 'click', () => {
    const list = $('#available-to-add-list');
    list.innerHTML = '';
    const g = activeGroups[activeChat];
    Object.keys(activeConversations).forEach(k => {
        if(!g.members[k]) {
            list.innerHTML += `<div class="list-item" onclick="window.addMember('${k}')"><img src="${activeConversations[k].user.avatar}"><div class="list-item-info"><b>${activeConversations[k].user.displayName}</b></div><button class="primary-btn" style="width:auto; padding:4px 8px; margin:0;">Добавить</button></div>`;
        }
    });
    $('#add-member-zone').style.display = 'block';
});
safeListen('close-add-member-btn', 'click', () => $('#add-member-zone').style.display = 'none');
window.addMember = async function(uid) {
    await update(ref(db, `groups/${activeChat}/members`), { [uid]: true });
    $('#add-member-zone').style.display = 'none';
    $('#members-modal').style.display = 'none';
};
// --- СОЗДАНИЕ БЕСЕДЫ ---
safeListen('create-group-trigger', 'click', () => {
    $('#group-contacts-list').innerHTML = '';
    Object.keys(activeConversations).forEach(k => {
        const u = activeConversations[k].user;
        $('#group-contacts-list').innerHTML += `<label class="stg-row"><span style="display:flex; align-items:center; gap:8px;"><img src="${u.avatar}" style="width:30px; height:30px; border-radius:50%;"><b>${u.displayName}</b></span><input type="checkbox" class="new-gr-cb" value="${k}" style="width:auto;" onchange="window.chkGr()"></label>`;
    });
    $('#group-modal').style.display = 'flex';
});
window.chkGr = () => $('#group-submit-btn').disabled = document.querySelectorAll('.new-gr-cb:checked').length < 2;
safeListen('group-cancel-btn', 'click', () => $('#group-modal').style.display = 'none');
safeListen('group-avatar-file', 'change', e => {
    const r = new FileReader();
    r.onload = () => { groupAvatarBase64 = r.result; $('group-preview').src = r.result; $('group-preview').style.display='block'; };
    r.readAsDataURL(e.target.files[0]);
});
safeListen('group-submit-btn', 'click', async () => {
    const name = $('group-name-input').value.trim();
    if(!name) return alert('Введите название!');
    const gld = 'group_' + Date.now();
    let members = { [user]: true };
    document.querySelectorAll('.new-gr-cb:checked').forEach(cb => members[cb.value] = true);
    await set(ref(db, `groups/${gld}`), { name: name, avatar: groupAvatarBase64||`https://ui-avatars.com/api/?name=${name}`, createdBy: user, members: members, timestamp: Date.now() });
    $('#group-modal').style.display = 'none';
    window.openChat(gld, name, groupAvatarBase64||`https://ui-avatars.com/api/?name=${name}`);
});

// ПЕРЕСЫЛКА
safeListen('ctx-forward', 'click', () => {
    $('#context-menu').style.display = 'none';
    const flist = $('#forward-chats-list');
    flist.innerHTML = '';
    Object.keys(activeConversations).forEach(k => {
        const u = activeConversations[k].user;
        flist.innerHTML += `<div class="list-item" onclick="window.fwdTo('${k}')"><img src="${u.avatar}"><b>${u.displayName}</b></div>`;
    });
    Object.keys(activeGroups).forEach(k => {
        const g = activeGroups[k];
        flist.innerHTML += `<div class="list-item" onclick="window.fwdTo('${k}')"><img src="${g.avatar||'https://ui-avatars.com/api/?name=G'}"><b>${g.name}</b></div>`;
    });
    $('#forward-modal').style.display = 'flex';
});
window.fwdTo = function(target) {
    const tMode = target.startsWith('group_') ? target : [user, target].sort().join('_');
    push(ref(db, `messages/${tMode}`), { sender: user, senderName: displayName, type: 'text', text: selectedMsgText, fwdFrom: knownUsers[selectedMsgSender]?.displayName||selectedMsgSender, timestamp: Date.now(), read: false });
    $('#forward-modal').style.display = 'none';
    alert('Переслано!');
};
safeListen('forward-cancel-btn', 'click', () => $('#forward-modal').style.display='none');

// ОСТАЛЬНОЕ
safeListen('login-submit-btn', 'click', login);
safeListen('avatar-file', 'change', e => { const r = new FileReader(); r.onload=()=>{$('login-preview').src=r.result; $('login-preview').style.display='block';}; r.readAsDataURL(e.target.files[0]); });
safeListen('modal-logout-btn', 'click', () => { localStorage.clear(); location.reload(); });
safeListen('my-profile-trigger', 'click', () => { $('modal-preview').src=avatar; $('modal-display-name-input').value=displayName; $('prof-modal').style.display='flex'; });
safeListen('modal-cancel-btn', 'click', () => $('#prof-modal').style.display='none');

const svK = localStorage.getItem('c_nk');
const svP = localStorage.getItem('c_pv');
if (svK && svP) {
    user = svK;
    get(ref(db, `users/${user}`)).then(snap => {
        if (snap.exists() && snap.val().password === svP) {
            const d = snap.val(); displayName = d.displayName||user; avatar = d.avatar||''; userColor = d.userColor||'#5288c1'; initApp();
        } else $('#login-screen').style.display = 'flex';
    }).catch(()=>$('#login-screen').style.display='flex');
} else $('#login-screen').style.display = 'flex';