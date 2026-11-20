/* =========================================================================
   Kitogram 4.0 — сообщения
   Композер, отправка (личные / группы / общий чат), медиа, рендер пузырей,
   контекстное меню, реакции, пересылка.
   ========================================================================= */
(function (KG) {
  'use strict';

  const { $, enc, now, S, escapeHTML, bus, api } = KG;

  let sending = false;
  let rec = { active: false, kind: 'voice', stream: null, recorder: null, chunks: [], startedAt: 0, timer: null, cancelled: false, mime: '' };
  let currentAudio = null;
  let typingWritten = 0;
  let typingTimer = null;
  let typingChat = null;
  let pendingImage = null;     // {src, thumb}
  let pendingReply = null;
  let pendingForward = null;

  const mediaLimit = {
    image: 6 * 1024 * 1024,
    voice: 5 * 1024 * 1024,
    video: 6 * 1024 * 1024
  };

  /* ============================ композер ============================ */
  const autoGrow = () => {
    const ta = $('message-input');
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
  };

  const updateSendButton = () => {
    const input = $('message-input');
    const btn = $('send-btn');
    if (!input || !btn) return;
    const ready = input.value.trim().length > 0 || !!pendingImage || !!pendingForward;
    btn.innerHTML = ready ? '<svg class="ic"><use href="#i-send"/></svg>' : '<svg class="ic"><use href="#i-mic"/></svg>';
    btn.title = ready ? 'Отправить' : 'Записать голосовое';
  };

  const previewBar = () => {
    const bar = $('preview-bar');
    if (!bar) return;
    bar.innerHTML = '';
    if (!pendingImage && !pendingReply && !pendingForward) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    if (pendingImage) {
      const img = document.createElement('img');
      img.className = 'preview-thumb';
      img.src = pendingImage.thumb || pendingImage.src;
      bar.appendChild(img);
    }
    const text = document.createElement('span');
    text.className = 'preview-text';
    if (pendingForward) text.innerHTML = '<b>Пересылка</b> · ' + escapeHTML(pendingForward.fwdFrom || '');
    else if (pendingReply) text.innerHTML = '<b>Ответ ' + escapeHTML(pendingReply.author) + '</b>: ' + escapeHTML(pendingReply.text || '');
    else text.textContent = 'Фото готово к отправке';
    bar.appendChild(text);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn';
    del.innerHTML = '<svg class="ic"><use href="#i-close"/></svg>';
    del.addEventListener('click', () => { pendingImage = null; pendingReply = null; pendingForward = null; previewBar(); updateSendButton(); });
    bar.appendChild(del);
  };

  const clearComposer = () => {
    $('message-input').value = '';
    autoGrow();
    pendingImage = null; pendingReply = null; pendingForward = null;
    previewBar();
    updateSendButton();
    if (S.activeChat) { S.drafts = S.drafts || {}; delete S.drafts[S.activeChat]; KG.storage.jsonSet(KG.KEY.drafts, S.drafts); }
  };

  /* ============================ отправка ============================ */
  async function send(payload) {
    const chatId = S.activeChat;
    if (!chatId || sending) return false;
    sending = true;
    $('send-btn').disabled = true;
    try {
      if (chatId.indexOf('group_') === 0 || chatId === KG.GLOBAL_KEY) await KG.Groups.send(chatId, payload);
      else await KG.Chat.send(chatId, payload);
      KG.sound.ping('out');
      KG.effects.burst();
      clearComposer();
      KG.Messages.render();
      KG.List.render();
      return true;
    } catch (e) {
      KG.toast('Сообщение не отправлено. Проверьте интернет.', true);
      return false;
    } finally {
      sending = false;
      $('send-btn').disabled = false;
    }
  }

  async function submit() {
    if (!S.activeChat) return;
    const text = $('message-input').value.trim();
    if (pendingForward) {
      const payload = Object.assign({}, pendingForward, { replyTo: pendingReply ? pendingReply : undefined });
      return send(payload);
    }
    if (!text && !pendingImage) { startRecording('voice'); return; }
    const payload = { type: 'text', text };
    if (pendingReply) payload.replyTo = pendingReply;
    if (pendingImage) {
      payload.type = 'image';
      payload.src = pendingImage.src;
      payload.thumb = pendingImage.thumb || pendingImage.src;
    }
    return send(payload);
  }

  /* ============================ вложения ============================ */
  async function pickPhoto() {
    const input = $('file-input');
    input.onchange = async () => {
      const f = input.files && input.files[0];
      input.value = '';
      if (!f) return;
      if (!/^image\//.test(f.type)) { KG.toast('Это не изображение', true); return; }
      try {
        KG.toast('Обработка фото…');
        const src = await KG.media.imageToDataURL(f, 1200, 0.82);
        const thumb = await KG.media.imageToDataURL(f, 220, 0.7);
        pendingImage = { src, thumb };
        KG.toast('');
        previewBar();
        updateSendButton();
        $('message-input').focus();
      } catch (e) { KG.toast('Не удалось обработать фото', true); }
    };
    input.click();
  }

  /* обрезка квадратного постера из видео */
  function grabPoster(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.src = url; v.muted = true; v.playsInline = true; v.preload = 'metadata';
      v.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
      v.onloadeddata = () => {
        try {
          const size = 160;
          const c = document.createElement('canvas');
          c.width = size; c.height = size;
          const ctx = c.getContext('2d');
          const side = Math.min(v.videoWidth, v.videoHeight);
          const sx = (v.videoWidth - side) / 2, sy = (v.videoHeight - side) / 2;
          ctx.drawImage(v, sx, sy, side, side, 0, 0, size, size);
          const out = c.toDataURL('image/jpeg', 0.7);
          URL.revokeObjectURL(url);
          resolve(out);
        } catch (e) { URL.revokeObjectURL(url); resolve(''); }
      };
      v.currentTime = 0.1;
    });
  }

  /* ============================ запись ============================ */
  function supportedMime(kind) {
    const list = kind === 'circle'
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    if (typeof MediaRecorder === 'undefined') return '';
    for (const t of list) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {} }
    return '';
  }

  async function startRecording(kind) {
    if (rec.active || !S.activeChat) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      KG.toast('Запись недоступна в этом браузере', true);
      return;
    }
    rec.kind = kind || 'voice';
    rec.active = true; rec.cancelled = false; rec.chunks = [];
    rec.mime = supportedMime(rec.kind);
    $('composer').classList.add('hidden');
    $('record-bar').classList.remove('hidden');
    $('record-hint').textContent = rec.kind === 'circle' ? 'Запись видеосообщения…' : 'Идёт запись…';
    $('record-time').textContent = '00:00';
    rec.startedAt = now();
    rec.timer = setInterval(() => {
      const sec = Math.floor((now() - rec.startedAt) / 1000);
      $('record-time').textContent = KG.formatDuration(sec);
      if (sec >= (rec.kind === 'circle' ? 60 : 180)) stopRecording(true);
    }, 250);
    try {
      const constraints = rec.kind === 'circle'
        ? { audio: { echoCancellation: true }, video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 }, frameRate: { ideal: 24 } } }
        : { audio: { echoCancellation: true, noiseSuppression: true } };
      rec.stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (rec.kind === 'circle') {
        const cam = $('cam-preview');
        cam.srcObject = rec.stream;
        cam.classList.remove('hidden');
        cam.play().catch(() => {});
      }
      const opts = rec.mime ? { mimeType: rec.mime } : {};
      if (rec.kind === 'circle') { opts.videoBitsPerSecond = 900000; opts.audioBitsPerSecond = 32000; }
      else opts.audioBitsPerSecond = 48000;
      rec.recorder = new MediaRecorder(rec.stream, opts);
      rec.mime = rec.recorder.mimeType || rec.mime;
      rec.recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
      rec.recorder.onstop = () => finishRecording();
      rec.recorder.start(200);
    } catch (e) {
      KG.toast('Нет доступа к микрофону или камере', true);
      abortRecording();
    }
  }

  function stopRecording(sendIt) {
    if (!rec.active) return;
    rec.cancelled = !sendIt;
    if (now() - rec.startedAt < 700) { rec.cancelled = true; KG.toast('Слишком короткая запись'); }
    if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop();
    else releaseRecordingUi();
  }

  async function finishRecording() {
    const elapsed = now() - rec.startedAt;
    const chunks = rec.chunks.slice();
    const mime = rec.mime || 'audio/webm';
    const kind = rec.kind;
    const cancelled = rec.cancelled;
    releaseRecordingUi();
    if (cancelled || !chunks.length || elapsed < 700) return;
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    if (blob.size > (kind === 'circle' ? mediaLimit.video : mediaLimit.voice)) { KG.toast('Запись слишком большая', true); return; }
    let poster = '';
    if (kind === 'circle') poster = await grabPoster(blob).catch(() => '');
    const reader = new FileReader();
    reader.onloadend = async () => {
      await send({
        type: kind === 'circle' ? 'video' : 'voice',
        src: String(reader.result),
        poster,
        duration: Math.round(elapsed / 1000),
        text: ''
      });
    };
    reader.readAsDataURL(blob);
  }

  function releaseRecordingUi() {
    rec.active = false;
    clearInterval(rec.timer); rec.timer = null;
    if (rec.stream) { rec.stream.getTracks().forEach((t) => t.stop()); rec.stream = null; }
    rec.recorder = null;
    $('cam-preview').classList.add('hidden');
    $('cam-preview').srcObject = null;
    $('record-bar').classList.add('hidden');
    $('composer').classList.remove('hidden');
    updateSendButton();
  }

  function abortRecording() {
    rec.cancelled = true;
    if (rec.recorder && rec.recorder.state !== 'inactive') { try { rec.recorder.stop(); } catch (e) {} }
    releaseRecordingUi();
  }

  /* ============================ рендер ============================ */
  const Messages = {
    render() {
      const chatId = S.activeChat;
      const box = $('messages');
      if (!chatId || !box) return;
      if (!box.dataset.chat || box.dataset.chat !== chatId) box.dataset.chat = chatId;
      if (currentAudio) { try { currentAudio.pause(); } catch (e) {} currentAudio = null; }
      const list = KG.Msgs.list(chatId);
      const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 180;
      const oldTop = box.scrollTop;
      box.innerHTML = '';
      if (!list.length) {
        const hint = document.createElement('div');
        hint.className = 'system-msg';
        hint.textContent = chatId === KG.GLOBAL_KEY ? 'Здесь начинается общий чат Kitogram' : 'История пуста — отправьте первое сообщение';
        box.appendChild(hint);
      }
      let lastDay = null, prev = null;
      list.forEach((m) => {
        const t = Number(m.ts || 0);
        const dk = KG.dayKey(t || now());
        if (dk !== lastDay) {
          lastDay = dk;
          const div = document.createElement('div');
          div.className = 'date-divider';
          div.textContent = KG.formatDay(t || now());
          box.appendChild(div);
          prev = null;
        }
        if (m.type === 'system') {
          const sys = document.createElement('div');
          sys.className = 'system-msg';
          sys.textContent = m.text || '';
          box.appendChild(sys);
          prev = null;
          return;
        }
        const grouped = !!(prev && prev.by === m.by && Math.abs(t - Number(prev.ts || 0)) < 5 * 60000);
        box.appendChild(Messages.row(chatId, m, grouped));
        prev = m;
      });
      if (stick) setTimeout(() => { box.scrollTop = box.scrollHeight; }, 0);
      else box.scrollTop = oldTop;
    },

    row(chatId, m, grouped) {
      const out = KG.Msgs.isMine(m);
      const row = document.createElement('div');
      row.className = 'row ' + (out ? 'out' : 'in') + (grouped ? ' grouped' : ' first');
      row.dataset.mid = m.id;
      const isGroup = chatId.indexOf('group_') === 0 || chatId === KG.GLOBAL_KEY;
      const bubble = document.createElement('div');
      bubble.className = 'bubble' + (m.pending ? ' pending' : '') + (m.failed ? ' failed' : '');
      if (isGroup && !out && !grouped) {
        const author = document.createElement('button');
        author.type = 'button';
        author.className = 'bubble-author grad-name';
        author.style.cssText = (KG.People.gradient(m.by) ? 'background:' + KG.People.gradient(m.by) + ';-webkit-background-clip:text;background-clip:text;color:transparent;' : 'color:' + (m.byColor || KG.People.color(m.by)));
        author.textContent = m.byName || KG.People.name(m.by);
        author.addEventListener('click', (e) => { e.stopPropagation(); KG.Profile.openCard(m.by); });
        bubble.appendChild(author);
      }
      if (m.fwdFrom) {
        const f = document.createElement('div');
        f.className = 'forward-head';
        f.innerHTML = '<svg class="ic"><use href="#i-forward"/></svg>Переслано от ' + escapeHTML(m.fwdFrom);
        bubble.appendChild(f);
      }
      if (m.replyTo) {
        const q = document.createElement('button');
        q.type = 'button';
        q.className = 'reply-quote';
        q.innerHTML = '<b>' + escapeHTML(m.replyTo.author || '') + '</b><span>' + escapeHTML((m.replyTo.text || '').slice(0, 120)) + '</span>';
        q.addEventListener('click', (e) => { e.stopPropagation(); if (m.replyTo.id) Messages.scrollTo(m.replyTo.id); });
        bubble.appendChild(q);
      }

      const type = m.type || 'text';
      if (type === 'image' && (m.src || m.thumb)) {
        bubble.classList.add('media');
        const img = document.createElement('img');
        img.className = 'msg-image';
        img.alt = 'Фото';
        img.loading = 'lazy';
        img.src = m.thumb || m.src;
        img.addEventListener('click', (e) => { e.stopPropagation(); KG.Viewer.image(m.src || m.thumb); });
        bubble.appendChild(img);
        if (m.text) { const cap = document.createElement('div'); cap.className = 'msg-caption'; cap.textContent = m.text; bubble.appendChild(cap); }
      } else if (type === 'gif' && (m.src || m.thumb)) {
        bubble.classList.add('media');
        const img = document.createElement('img');
        img.className = 'msg-gif';
        img.alt = 'GIF';
        img.src = m.thumb || m.src;
        img.dataset.full = m.src || '';
        img.addEventListener('click', (e) => { e.stopPropagation(); KG.Viewer.image(img.dataset.full || img.src); });
        bubble.appendChild(img);
      } else if (type === 'voice' && m.src) {
        bubble.appendChild(Messages.voice(m));
      } else if (type === 'video' && m.src) {
        bubble.classList.add('media');
        bubble.appendChild(Messages.circle(m));
      } else {
        const t = document.createElement('div');
        t.className = 'msg-text';
        Messages.text(t, m.text || '');
        bubble.appendChild(t);
      }

      const meta = document.createElement('span');
      meta.className = 'msg-meta';
      if (m.edited) { const ed = document.createElement('span'); ed.className = 'edited'; ed.textContent = 'изм.'; meta.appendChild(ed); }
      meta.appendChild(document.createTextNode(KG.formatTime(m.ts)));
      if (m.pending) { const dot = document.createElement('span'); dot.className = 'pending-dot'; dot.title = 'Отправляется…'; meta.appendChild(dot); }
      if (m.failed) { const err = document.createElement('span'); err.className = 'failed-mark'; err.textContent = '!'; err.title = 'Не отправлено'; meta.appendChild(err); }
      if (out && chatId.indexOf('group_') !== 0 && chatId !== KG.GLOBAL_KEY) {
        const peerRead = Number((S.nodes.acc.read && S.nodes.acc.read[chatId]) || 0);
        const ticks = document.createElement('span');
        ticks.className = 'ticks' + (peerRead >= Number(m.ts || 0) ? ' read' : '');
        ticks.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>' + (peerRead >= Number(m.ts || 0) ? '<svg class="ic"><use href="#i-check"/></svg>' : '');
        meta.appendChild(ticks);
      }
      bubble.appendChild(meta);

      const emojis = KG.Msgs.reactions(m);
      if (emojis.length) {
        const wrap = document.createElement('div');
        wrap.className = 'reactions';
        emojis.forEach((e) => {
          const users = m.reactions[e] || {};
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'reaction' + (users[S.uid] ? ' mine' : '');
          b.textContent = e + ' ' + Object.keys(users).length;
          b.addEventListener('click', (ev) => { ev.stopPropagation(); KG.Msgs.react(chatId, m.id, e); });
          wrap.appendChild(b);
        });
        bubble.appendChild(wrap);
      }

      Messages.attachMenu(bubble, chatId, m);
      row.appendChild(bubble);
      return row;
    },

    text(el, text) {
      const clean = String(text || '');
      const onlyEmoji = clean.trim().length > 0 && /^[\p{Extended_Pictographic}\u200D\uFE0F\s]+$/u.test(clean) && clean.trim().length <= 24;
      el.innerHTML = KG.escapeHTML(clean)
        .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>');
      if (onlyEmoji) el.classList.add('big-emoji');
    },

    voice(m) {
      const wrap = document.createElement('div');
      wrap.className = 'voice-player';
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'voice-play';
      play.innerHTML = '<svg class="ic"><use href="#i-play"/></svg>';
      const track = document.createElement('div');
      track.className = 'voice-track';
      const wave = document.createElement('div');
      wave.className = 'voice-wave';
      const seed = KG.hashStr(m.id || m.src || '');
      for (let i = 0; i < 26; i++) {
        const bar = document.createElement('i');
        bar.style.height = (5 + ((seed >> (i % 16)) & 15)) + 'px';
        wave.appendChild(bar);
      }
      const dur = document.createElement('span');
      dur.className = 'voice-time';
      dur.textContent = KG.formatDuration(m.duration || 0);
      track.append(wave, dur);
      wrap.append(play, track);
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = m.src;
      audio.addEventListener('timeupdate', () => {
        const d = audio.duration || m.duration || 1;
        const ratio = Math.min(1, (audio.currentTime || 0) / d);
        Array.from(wave.children).forEach((b, i) => b.classList.toggle('played', i / 26 <= ratio));
        dur.textContent = KG.formatDuration(audio.currentTime || d);
      });
      audio.addEventListener('ended', () => { play.innerHTML = '<svg class="ic"><use href="#i-play"/></svg>'; });
      play.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!audio.paused) { audio.pause(); play.innerHTML = '<svg class="ic"><use href="#i-play"/></svg>'; return; }
        if (currentAudio && currentAudio !== audio) currentAudio.pause();
        currentAudio = audio;
        audio.play().then(() => { play.innerHTML = '<svg class="ic"><use href="#i-stop"/></svg>'; }).catch(() => KG.toast('Не удалось воспроизвести', true));
      });
      return wrap;
    },

    circle(m) {
      const wrap = document.createElement('div');
      wrap.className = 'circle-msg';
      const video = document.createElement('video');
      video.playsInline = true;
      video.preload = 'metadata';
      video.src = m.src;
      if (m.poster) video.poster = m.poster;
      const icon = document.createElement('span');
      icon.className = 'play-circle';
      icon.innerHTML = '<svg class="ic"><use href="#i-play"/></svg>';
      if (!m.poster) video.classList.add('no-poster');
      wrap.append(video, icon);
      video.addEventListener('click', (e) => {
        e.stopPropagation();
        if (video.paused) {
          const p = video.play();
          if (p && p.catch) p.catch(() => KG.toast('Не удалось воспроизвести', true));
          icon.classList.add('hidden');
        } else { video.pause(); icon.classList.remove('hidden'); }
      });
      video.addEventListener('pause', () => icon.classList.remove('hidden'));
      video.addEventListener('ended', () => icon.classList.remove('hidden'));
      return wrap;
    },

    attachMenu(el, chatId, m) {
      const open = (x, y) => {
        const mine = KG.Msgs.isMine(m);
        const canAll = chatId.indexOf('group_') === 0 || chatId === KG.GLOBAL_KEY;
        const items = [];
        if (!m.pending) items.push({ icon: 'i-reply', label: 'Ответить', action: () => { pendingReply = { id: m.id, author: mine ? 'Вы' : (m.byName || KG.People.name(m.by)), text: (m.text || (m.type === 'image' ? 'Фото' : m.type === 'voice' ? 'Голосовое' : 'Медиа')).slice(0, 120) }; previewBar(); $('message-input').focus(); } });
        if (m.text) items.push({ icon: 'i-copy', label: 'Копировать', action: () => KG.copyText(m.text) });
        if (!m.pending) items.push({ icon: 'i-forward', label: 'Переслать', action: () => KG.Forward.open(m) });
        items.push({ icon: 'i-heart', label: '❤️ Реакция', action: () => KG.Msgs.react(chatId, m.id, '❤️') });
        items.push({ icon: 'i-eye-off', label: 'Удалить у себя', action: () => KG.Msgs.hideForMe(chatId, m.id) });
        if (canAll && (mine || (chatId.indexOf('group_') === 0 && KG.Groups.isCreator(chatId)))) {
          items.push({ icon: 'i-trash', label: 'Удалить у всех', danger: true, action: () => { if (confirm('Удалить сообщение у всех?')) KG.Msgs.removeForAll(chatId, m.id); } });
        }
        KG.Popover.show(x, y, items);
      };
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); open(e.clientX, e.clientY); });
      let timer = null, sx = 0, sy = 0;
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        sx = e.clientX; sy = e.clientY;
        timer = setTimeout(() => { timer = null; open(e.clientX, e.clientY); }, 480);
      });
      el.addEventListener('pointermove', (e) => { if (timer && (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12)) { clearTimeout(timer); timer = null; } });
      ['pointerup', 'pointercancel'].forEach((t) => el.addEventListener(t, () => { if (timer) { clearTimeout(timer); timer = null; } }));
    },

    scrollTo(mid) {
      const el = $('messages') && $('messages').querySelector('[data-mid="' + (window.CSS && CSS.escape ? CSS.escape(mid) : mid) + '"]');
      if (!el) return;
      if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    },

    updateSendButton,
    autoGrow,
    previewBar,
    startRecording,
    stopRecording,
    clearComposer
  };

  /* ============================ пересылка ============================ */
  const Forward = {
    open(m) {
      pendingForward = KG.Msgs.forwardPayload(m);
      pendingReply = null;
      previewBar();
      KG.toast('Выберите чат в списке или откройте «Переслать в…»');
      const items = KG.Dialogs.sorted().slice(0, 30).map((d) => ({
        label: d.title,
        action: async () => {
          try {
            if (d.chatId.indexOf('group_') === 0 || d.chatId === KG.GLOBAL_KEY) await KG.Groups.send(d.chatId, Object.assign({}, pendingForward));
            else await KG.Chat.send(d.chatId, Object.assign({}, pendingForward));
            pendingForward = null; previewBar(); updateSendButton();
            KG.toast('Переслано в «' + d.title + '»');
          } catch (e) { KG.toast('Не удалось переслать', true); }
        }
      }));
      const r = $('ctx-menu').getBoundingClientRect();
      KG.Popover.show(Math.max(12, r.left - 40), Math.max(12, r.top - 40), items);
    }
  };

  /* ============================ обработчики ============================ */
  const bind = () => {
    const input = $('message-input');
    input.addEventListener('input', () => {
      autoGrow();
      updateSendButton();
      if (S.activeChat && S.drafts) { S.drafts[S.activeChat] = input.value; }
      // «печатает…»
      if (!S.typingHidden && S.activeChat && S.activeChat !== KG.GLOBAL_KEY) {
        const chat = S.activeChat;
        typingChat = chat;
        if (now() - typingWritten > 2600) { typingWritten = now(); KG.Chat.setTyping(chat); }
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => { if (typingChat) KG.Chat.clearTyping(typingChat); typingChat = null; typingWritten = 0; }, 3400);
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !KG.isTouch()) {
        e.preventDefault();
        if (input.value.trim() || pendingImage || pendingForward) submit();
      }
    });
    input.addEventListener('paste', (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const item of items) {
        if (item.type && item.type.indexOf('image/') === 0) {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          KG.media.imageToDataURL(file, 1200, 0.82).then((src) => {
            return KG.media.imageToDataURL(file, 220, 0.7).then((thumb) => ({ src, thumb }));
          }).then((p) => { pendingImage = p; previewBar(); updateSendButton(); })
            .catch(() => KG.toast('Не удалось вставить изображение', true));
          break;
        }
      }
    });
    $('composer').addEventListener('submit', (e) => { e.preventDefault(); submit(); });

    $('attach-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = $('attach-menu');
      if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
      const r = $('attach-btn').getBoundingClientRect();
      menu.classList.remove('hidden');
      const mr = menu.getBoundingClientRect();
      menu.style.left = Math.max(8, r.left) + 'px';
      menu.style.top = Math.max(8, r.top - mr.height - 8) + 'px';
    });
    $('attach-menu').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-attach]');
      if (!btn) return;
      $('attach-menu').classList.add('hidden');
      const kind = btn.dataset.attach;
      if (kind === 'photo') pickPhoto();
      else startRecording(kind);
    });

    $('record-cancel').addEventListener('click', () => stopRecording(false));
    $('record-stop').addEventListener('click', () => stopRecording(true));

    window.addEventListener('popstate', () => { if (S.activeChat) KG.ChatUI.close(); });
    window.addEventListener('pagehide', () => {
      if (typingChat) KG.Chat.clearTyping(typingChat);
    });
    bus.on('messages', KG.debounce((chatId) => {
      if (!S.activeChat) return;
      if (chatId === null || chatId === S.activeChat) Messages.render();
    }, 70));
    bus.on('read', () => { if (S.activeChat) Messages.render(); });
    bus.on('chat', () => { Messages.render(); });
  };

  KG.Messages = Messages;
  KG.Forward = Forward;
  KG.messagesBind = bind;
  KG.composer = { submit, send, previewBar, updateSendButton, getPending: () => ({ pendingImage, pendingReply, pendingForward }) };
})(window.KG);
