/* =========================================================================
   Kitogram 4.0 — ядро
   Общие утилиты, REST-клиент Firebase и realtime-транспорт (SSE + поллинг).
   Каждый пользователь держит свои переписки у себя в аккаунте:
     accounts/<uid>/messages/<peer>/<mid>  — личные сообщения
     accounts/<uid>/chats/<peer>           — метаданные личных чатов
     inbox/<uid>/<from>/<mid>              — «доставка» входящих
     people/<uid>                          — лёгкий публичный профиль
     media/<uid>                           — тяжёлые аватары/обложки (по запросу)
     chats/<gid>                           — группы
     messages/<gid>                        — сообщения групп и общего чата
   ========================================================================= */
window.KG = (function () {
  'use strict';

  const DB = 'https://messenger-2e22b-default-rtdb.firebaseio.com';
  const VERSION = '4.0';
  const SCHEMA = 4;
  const GLOBAL_KEY = 'global';           // messages/global — общий чат
  const COLORS = ['#2f9ede', '#5288c1', '#7a5af8', '#e57373', '#4db6ac', '#ffb74d', '#9575cd', '#4fc3f7', '#f06292', '#81c784', '#a855f7', '#f59e0b'];

  const KEY = {
    uid: 'kg_uid', auth: 'kg_auth', name: 'kg_name', avatar: 'kg_av',
    settings: 'kg_settings', drafts: 'kg_drafts', read: 'kg_read', hiddenMsgs: 'kg_hidden_msgs', settingsTs: 'kg_settings_ts',
    hidden: 'kg_hidden', muted: 'kg_muted', pinned: 'kg_pinned',
    gh: 'kg_gh_token', wiped: 'kg_schema', mediaCache: 'kg_media_v'
  };

  /* ------------------------------ утилиты ------------------------------ */
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    json(k, fb) {
      const raw = storage.get(k);
      if (!raw) return fb;
      try { const v = JSON.parse(raw); return v == null ? fb : v; } catch (e) { return fb; }
    },
    jsonSet(k, v) { storage.set(k, JSON.stringify(v)); }
  };

  const escapeHTML = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const hashStr = (s) => {
    let h = 0;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  };

  const uidColor = (uid) => COLORS[hashStr(String(uid || '?')) % COLORS.length];

  const avatarFallback = (name, seed) => {
    const clean = String(name || '?').replace(/^@+/, '').trim();
    const letter = (clean.charAt(0) || '?').toUpperCase();
    const bg = COLORS[hashStr(seed || name || '?') % COLORS.length];
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + bg + '"/><stop offset="1" stop-color="#1d2a36"/></linearGradient></defs>' +
      '<rect width="96" height="96" fill="url(#g)"/>' +
      '<text x="48" y="63" font-family="Arial,Helvetica,sans-serif" font-size="44" font-weight="600" fill="#ffffff" text-anchor="middle">' +
      escapeHTML(letter) + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };

  const enc = (v) => encodeURIComponent(String(v == null ? '' : v));
  const dec = (v) => { try { return decodeURIComponent(String(v)); } catch (e) { return String(v); } };

  const now = () => Date.now();
  const newId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
  const fullDateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
  const formatTime = (ts) => (ts ? timeFmt.format(new Date(ts)) : '');
  const formatDay = (ts) => {
    if (!ts) return '';
    if (dayKey(ts) === dayKey(now())) return 'Сегодня';
    if (dayKey(ts) === dayKey(now() - 864e5)) return 'Вчера';
    return new Date(ts).getFullYear() === new Date().getFullYear() ? dateFmt.format(new Date(ts)) : fullDateFmt.format(new Date(ts));
  };
  const formatListTime = (ts) => {
    if (!ts) return '';
    if (dayKey(ts) === dayKey(now())) return formatTime(ts);
    if (dayKey(ts) === dayKey(now() - 864e5)) return 'Вчера';
    return new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  };
  const formatDuration = (sec) => {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };

  const debounce = (fn, ms) => {
    let t = null, lastArgs = null;
    const wrapped = (...a) => {
      lastArgs = a;
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...lastArgs); }, ms);
    };
    wrapped.flush = () => { if (t) { clearTimeout(t); t = null; fn(...(lastArgs || [])); } };
    return wrapped;
  };
  const throttle = (fn, ms) => {
    let at = 0;
    return (...a) => { const t = now(); if (t - at >= ms) { at = t; fn(...a); } };
  };

  const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: window.innerWidth <= 760 });
  const isTouch = () => mq('(pointer: coarse)').matches;

  const sha256 = async (text) => {
    const str = String(text);
    if (window.crypto && window.crypto.subtle && window.isSecureContext) {
      try {
        const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {}
    }
    // запасной хеш для http:// и старых браузеров (не криптостойкий, но стабильный)
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < str.length; i++) {
      h1 = Math.imul(h1 ^ str.charCodeAt(i), 16777619) >>> 0;
      h2 = Math.imul(h2 + str.charCodeAt(i), 2654435761) >>> 0;
    }
    return 'fallback$' + h1.toString(16) + h2.toString(16);
  };

  const randomCode = (len) => {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    const rnd = (window.crypto && window.crypto.getRandomValues) ? null : null;
    for (let i = 0; i < len; i++) {
      let r;
      if (window.crypto && window.crypto.getRandomValues) {
        r = window.crypto.getRandomValues(new Uint8Array(1))[0];
      } else r = Math.floor(Math.random() * 256);
      out += abc[r % abc.length];
    }
    return out;
  };
  const makeRecoveryCode = () => 'KG-' + randomCode(4) + '-' + randomCode(4) + '-' + randomCode(4);

  /* --------------------------- DOM-помощники --------------------------- */
  const toast = (message, isError) => {
    const box = $('toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .2s, transform .2s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 240);
    }, 2800);
  };

  const openModal = (id) => {
    const el = typeof id === 'string' ? $(id) : id;
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('show');
    document.body.classList.add('modal-open');
  };
  const closeModal = (el) => {
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('show');
    if (!$('.modal.show')) document.body.classList.remove('modal-open');
    if (el.id === 'video-modal') { const v = $('video-view'); if (v) { try { v.pause(); } catch (e) {} v.removeAttribute('src'); v.load(); } }
    if (el.id === 'profile-modal') KG.profile && KG.profile.onClose && KG.profile.onClose();
  };
  const closeAllModals = () => { $$('.modal').forEach(closeModal); };
  const closePopovers = () => {
    ['ctx-menu', 'attach-menu', 'reaction-bar'].forEach((id) => { const el = $(id); if (el) el.classList.add('hidden'); });
  };

  const setImg = (img, src, fallbackName, seed) => {
    if (!img) return;
    const ok = src && /^(data:|https?:|blob:)/.test(String(src));
    img.src = ok ? src : avatarFallback(fallbackName, seed);
  };

  /* --------------------------- Firebase REST --------------------------- */
  const api = {
    base: DB,
    url(path, query) {
      let u = api.base + '/' + String(path || '').split('/').filter(Boolean).map(enc).join('/') + '.json';
      if (query) u += '?' + new URLSearchParams(query).toString();
      return u;
    },
    async request(method, path, body, query, extraHeaders) {
      const headers = Object.assign({}, extraHeaders || {});
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(api.url(path, query), {
        method,
        headers: Object.keys(headers).length ? headers : undefined,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (!text) return null;
      try { return JSON.parse(text); } catch (e) { return null; }
    },
    get: (p, q, h) => api.request('GET', p, undefined, q, h),
    put: (p, v) => api.request('PUT', p, v),
    patch: (p, v) => api.request('PATCH', p, v),
    post: (p, v) => api.request('POST', p, v),
    del: (p) => api.request('DELETE', p)
  };

  /* ------------------------------- шина ------------------------------- */
  const bus = {
    map: new Map(),
    on(evt, fn) {
      if (!bus.map.has(evt)) bus.map.set(evt, new Set());
      bus.map.get(evt).add(fn);
      return () => bus.map.get(evt).delete(fn);
    },
    emit(evt, payload) {
      const set = bus.map.get(evt);
      if (!set) return;
      set.forEach((fn) => { try { fn(payload); } catch (e) { console.error('KG bus', evt, e); } });
    }
  };

  /* ---------------------------- состояние ---------------------------- */
  const S = {
    uid: null,
    me: {},                 // своя запись people
    self: {},               // своя запись users (с приватными полями)
    ready: false,
    activeChat: null,
    usersLoaded: false,
    nodes: {
      people: {}, status: {}, typing: {}, seen: {}, chats: {}, global: {},
      acc: { chats: {}, messages: {}, read: {} },
      inbox: {}
    },
    groupMsgs: {},          // gid -> {messages}
    media: {},              // uid -> {avatar, cover}
    mediaSelf: {},          // свои тяжёлые медиа
    hiddenMsgs: {},         // chatId -> {mid:true}
    online: navigator.onLine,
    channelReady: false,
    typingHidden: false,
    lastIncomingTs: 0
  };

  /* --------------------------- realtime --------------------------- */
  const live = {
    streams: new Map(),
    started: false,

    paths() {
      const uid = S.uid;
      const list = [
        { key: 'people', path: 'people' },
        { key: 'status', path: 'status' },
        { key: 'chats', path: 'chats' },
        { key: 'seen', path: 'seen' },
        { key: 'global', path: 'messages/' + GLOBAL_KEY }
      ];
      if (uid) {
        list.push({ key: 'acc', path: 'accounts/' + enc(uid) });
        list.push({ key: 'inbox', path: 'inbox/' + enc(uid) });
        list.push({ key: 'typing', path: 'typing' });
      }
      return list;
    },

    start() {
      if (this.started) return;
      this.started = true;
      this.paths().forEach((p) => this.open(p.key, p.path));
      // сторожевой таймер: если поток умер или давно молчит — полный перезапрос
      if (!this.timer) {
        this.timer = setInterval(() => {
          if (!S.uid) return;
          this.paths().forEach((p) => {
            const st = this.streams.get(p.key);
            if (!st) return;
            const dead = !st.es || st.es.readyState === 2;
            const silent = now() - (st.lastData || 0) > 90000;
            if (dead || silent) this.resync(p.key, p.path);
            if (dead && 'EventSource' in window && now() - (st.reopenAt || 0) > 15000) {
              st.reopenAt = now();
              this.open(p.key, p.path, true);
            }
          });
        }, 12000);
      }
    },

    stop() {
      this.streams.forEach((st) => { try { if (st.es) st.es.close(); } catch (e) {} });
      this.streams.clear();
      this.started = false;
    },

    open(key, path, force) {
      const prev = this.streams.get(key);
      if (prev && !force) return;
      if (prev) { try { prev.es && prev.es.close(); } catch (e) {} }
      const st = { key, path, es: null, lastData: now(), ready: false, reopenAt: 0 };
      this.streams.set(key, st);
      if (!('EventSource' in window)) { this.resync(key, path); return; }
      try {
        const es = new EventSource(api.url(path));
        st.es = es;
        es.addEventListener('open', () => { st.ready = true; S.channelReady = true; bus.emit('net'); });
        es.addEventListener('put', (ev) => {
          st.lastData = now();
          st.ready = true;
          S.channelReady = true;
          let d;
          try { d = JSON.parse(ev.data); } catch (e) { return; }
          live.apply(key, d.path || '/', d.data);
          bus.emit('net');
        });
        es.addEventListener('patch', (ev) => {
          st.lastData = now();
          let d;
          try { d = JSON.parse(ev.data); } catch (e) { return; }
          const base = (d.path || '/');
          Object.keys(d.data || {}).forEach((k) => live.apply(key, base + '/' + k, d.data[k]));
        });
        es.addEventListener('keep-alive', () => { st.lastData = now(); });
        es.addEventListener('cancel', () => { st.ready = false; S.channelReady = false; bus.emit('net'); });
        es.addEventListener('error', () => { st.ready = false; S.channelReady = false; bus.emit('net'); });
      } catch (e) {
        this.resync(key, path);
      }
    },

    async resync(key, path) {
      if (!S.uid && /accounts|inbox/.test(path)) return;
      try {
        const data = await api.get(path);
        live.apply(key, '/', data || {});
      } catch (e) { /* нет сети — попробуем позже */ }
    },

    apply(key, rel, value) {
      const parts = String(rel || '/').split('/').filter(Boolean);
      const roots = S.nodes;
      if (!(key in roots)) roots[key] = {};
      if (!parts.length) {
        roots[key] = value || {};
      } else {
        let node = roots[key];
        for (let i = 0; i < parts.length - 1; i++) {
          if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
          node = node[parts[i]];
        }
        const leaf = parts[parts.length - 1];
        if (value === null || value === undefined) delete node[leaf];
        else node[leaf] = value;
      }
      if (key === 'people') S.usersLoaded = true;
      bus.emit('data', { key, path: parts });
    }
  };

  /* --------------------------- медиа --------------------------- */
  const media = {
    cache: new Map(),           // uid -> {avatar, cover}
    inflight: new Map(),

    dataUrl(file) {
      return new Promise((resolve, reject) => {
        let timer = null;
        let done = false;
        const finish = (ok, val) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (ok) resolve(val); else reject(val);
        };
        timer = setTimeout(() => finish(false, new Error('read timeout')), 20000);
        try {
          const r = new FileReader();
          r.onerror = () => finish(false, new Error('read'));
          r.onload = () => finish(true, String(r.result));
          r.readAsDataURL(file);
        } catch (e) { finish(false, new Error('read')); }
      });
    },

    loadImage(src) {
      return new Promise((resolve, reject) => {
        let timer = null;
        let done = false;
        const finish = (ok, val) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (ok) resolve(val); else reject(val);
        };
        // страховка: битый/огромный файл не должен вешать обработку
        timer = setTimeout(() => finish(false, new Error('decode timeout')), 8000);
        try {
          const img = new Image();
          img.onload = () => finish(true, img);
          img.onerror = () => finish(false, new Error('decode'));
          img.src = src;
        } catch (e) { finish(false, new Error('decode')); }
      });
    },

    async imageToDataURL(file, maxSide, quality) {
      const raw = await media.dataUrl(file);
      let img;
      try {
        img = await media.loadImage(raw);
      } catch (e) {
        // формат не декодируется (HEIC, битый файл) — отправляем как есть, если не слишком тяжёлый
        if (raw.length < 2600000) return raw;
        throw new Error('Не удалось обработать изображение');
      }
      let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h) throw new Error('bad image');
      const scale = Math.min(1, (maxSide || 1000) / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) return raw;   // нет canvas (старый браузер) — отдаём как есть
      ctx.drawImage(img, 0, 0, w, h);
      let out = '';
      try { out = canvas.toDataURL('image/webp', quality || 0.82); } catch (e) { out = ''; }
      if (!out || out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/jpeg', quality || 0.82);
      return out;
    },

    /* Обложка профиля: картинка, GIF или короткое видео без звука */
    async coverFromFile(file, opts) {
      opts = opts || {};
      const maxBytes = opts.maxBytes || 3.4 * 1024 * 1024;
      const type = String(file.type || '');
      if (/^image\/gif$/i.test(type)) {
        const data = await media.dataUrl(file);
        if (data.length > maxBytes) throw new Error('Слишком большой GIF (максимум ~2,5 МБ)');
        return { kind: 'gif', src: data, cover: 'image' };
      }
      if (/^image\//.test(type)) {
        const data = await media.imageToDataURL(file, opts.maxSide || 1280, 0.84);
        if (data.length > maxBytes) throw new Error('Не удалось сжать картинку — попробуйте другую');
        return { kind: 'image', src: data, cover: 'image' };
      }
      if (/^video\//.test(type)) {
        try {
          const out = await media.transcodeCover(file, opts);
          return { kind: 'video', src: out, cover: 'video' };
        } catch (e) {
          if (file.size <= 2.4 * 1024 * 1024) {
            const data = await media.dataUrl(file);
            return { kind: 'video', src: data, cover: 'video' };
          }
          throw new Error('Видео не удалось сжать. Выберите файл до 2,5 МБ или короткий клип.');
        }
      }
      throw new Error('Нужна картинка, GIF или видео');
    },

    transcodeCover(file, opts) {
      return new Promise(async (resolve, reject) => {
        if (typeof MediaRecorder === 'undefined') { reject(new Error('no recorder')); return; }
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        const cleanup = () => { try { URL.revokeObjectURL(url); } catch (e) {} };
        video.addEventListener('error', () => { cleanup(); reject(new Error('video')); });
        video.addEventListener('loadeddata', async () => {
          try {
            const maxSide = opts.maxSide || 720;
            const maxSec = Math.min(opts.maxSec || 4, video.duration || 4);
            const vw = video.videoWidth || 720, vh = video.videoHeight || 1280;
            const scale = Math.min(1, maxSide / Math.max(vw, vh));
            const w = Math.max(2, Math.round(vw * scale / 2) * 2);
            const h = Math.max(2, Math.round(vh * scale / 2) * 2);
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            const stream = canvas.captureStream(24);
            const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => {
              try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; }
            }) || '';
            const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2200000 } : {});
            const chunks = [];
            rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
            rec.onstop = async () => {
              cleanup();
              try {
                const blob = new Blob(chunks, { type: 'video/webm' });
                const data = await media.dataUrl(blob);
                if (data.length > 3.4 * 1024 * 1024) reject(new Error('big'));
                else resolve(data);
              } catch (e) { reject(e); }
            };
            rec.start(120);
            video.currentTime = 0;
            await video.play().catch(() => {});
            const t0 = performance.now();
            const draw = () => {
              ctx.drawImage(video, 0, 0, w, h);
              if (performance.now() - t0 < maxSec * 1000 && !video.ended) requestAnimationFrame(draw);
              else { try { rec.stop(); } catch (e) { reject(e); } }
            };
            draw();
          } catch (e) { cleanup(); reject(e); }
        });
      });
    },

    /* загрузка тяжёлого медиа пользователя (аватар/обложка) */
    async fetchUserMedia(uid, force) {
      if (!uid) return null;
      if (!force && media.cache.has(uid)) return media.cache.get(uid);
      if (media.inflight.has(uid)) return media.inflight.get(uid);
      const p = api.get('media/' + enc(uid)).then((data) => {
        const val = data || {};
        media.cache.set(uid, val);
        media.inflight.delete(uid);
        bus.emit('media', uid);
        return val;
      }).catch(() => { media.inflight.delete(uid); return null; });
      media.inflight.set(uid, p);
      return p;
    },

    async saveUserMedia(uid, patch) {
      const cur = (media.cache.get(uid) || {});
      media.cache.set(uid, Object.assign({}, cur, patch));
      await api.patch('media/' + enc(uid), patch);
    },

    invalidate(uid) { media.cache.delete(uid); }
  };

  /* --------------------------- звук и эффекты --------------------------- */
  const sound = {
    ctx: null,
    enabled() { return !S.settings || S.settings.sound !== false; },
    ping(kind) {
      if (!sound.enabled()) return;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!sound.ctx) sound.ctx = new Ctx();
        const ctx = sound.ctx;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(kind === 'out' ? 660 : 880, t);
        o.frequency.exponentialRampToValueAtTime(kind === 'out' ? 880 : 1180, t + 0.08);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g).connect(ctx.destination);
        o.start(t); o.stop(t + 0.2);
      } catch (e) {}
    }
  };

  const effects = {
    enabled() { return !S.settings || S.settings.effects !== false; },
    burst(x, y) {
      if (!effects.enabled()) return;
      const host = document.createElement('div');
      host.className = 'fx-burst';
      host.style.left = (x || window.innerWidth - 70) + 'px';
      host.style.top = (y || window.innerHeight - 90) + 'px';
      const colors = ['#2f9ede', '#a855f7', '#4fc3f7', '#f06292', '#ffb74d', '#81c784'];
      for (let i = 0; i < 14; i++) {
        const p = document.createElement('i');
        const ang = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
        const dist = 26 + Math.random() * 34;
        p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
        p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
        p.style.background = colors[i % colors.length];
        p.style.animationDelay = (Math.random() * 40) + 'ms';
        host.appendChild(p);
      }
      document.body.appendChild(host);
      setTimeout(() => host.remove(), 780);
    },
    pop(el) {
      if (!el || !effects.enabled()) return;
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    }
  };

  /* --------------------------- оформление --------------------------- */
  const DEFAULTS = {
    settings: {
      accent: '#2f9ede', theme: 'dark', bubble: 'rounded', font: 15,
      wallpaper: '', wallPreset: 'none', wallDim: 35, sound: true, hideTyping: false, effects: true
    },
    cover: { type: 'gradient', preset: 'aurora', blur: false, dim: 24 }
  };

  const gradients = {
    aurora: 'linear-gradient(135deg,#2f9ede 0%,#7a5af8 48%,#f06292 100%)',
    sunset: 'linear-gradient(135deg,#ff9966 0%,#ff5e62 55%,#a855f7 100%)',
    ocean: 'linear-gradient(135deg,#0f2027 0%,#2c5364 55%,#00d2ff 100%)',
    mint: 'linear-gradient(135deg,#00b09b 0%,#96c93d 100%)',
    neon: 'linear-gradient(135deg,#8a2be2 0%,#ff2e97 60%,#ffcc00 100%)',
    graphite: 'linear-gradient(135deg,#232526 0%,#414345 100%)',
    candy: 'linear-gradient(135deg,#fbc2eb 0%,#a6c1ee 100%)',
    lava: 'linear-gradient(135deg,#200122 0%,#6f0000 60%,#ff512f 100%)',
    forest: 'linear-gradient(135deg,#0b3d2e 0%,#1f7a4d 50%,#a8e063 100%)',
    midnight: 'linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)'
  };

  const applySettings = (next, opts) => {
    const s = Object.assign({}, DEFAULTS.settings, S.settings || {}, next || {});
    S.settings = s;
    storage.jsonSet(KEY.settings, s);
    if (!opts || !opts.local) SettingsSync.push(s);
    const root = document.documentElement;
    root.dataset.theme = s.theme === 'light' ? 'light' : 'dark';
    root.dataset.bubble = s.bubble || 'rounded';
    root.style.setProperty('--accent', s.accent);
    root.style.setProperty('--accent-strong', shade(s.accent, -14));
    root.style.setProperty('--accent-soft', hexAlpha(s.accent, 0.16));
    root.style.setProperty('--font-size', (Number(s.font) || 15) + 'px');
    const wall = $('messages');
    if (wall) {
      if (s.wallpaper) {
        wall.style.backgroundImage = 'linear-gradient(rgba(0,0,0,' + (Number(s.wallDim) || 0) / 100 + '),rgba(0,0,0,' + (Number(s.wallDim) || 0) / 100 + ')), url("' + String(s.wallpaper).replace(/"/g, '\\"') + '")';
        wall.classList.add('has-wall');
      } else if (s.wallPreset && s.wallPreset !== 'none' && gradients[s.wallPreset]) {
        wall.style.backgroundImage = gradients[s.wallPreset];
        wall.style.backgroundSize = 'cover';
        wall.classList.add('has-wall');
      } else {
        wall.style.backgroundImage = '';
        wall.classList.remove('has-wall');
      }
    }
    bus.emit('settings', s);
    return s;
  };

  /* цветовые помощники */
  function hexToRgb(hex) {
    const h = String(hex || '').replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(v, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function shade(hex, percent) {
    try {
      const { r, g, b } = hexToRgb(hex);
      const f = (c) => Math.max(0, Math.min(255, Math.round(c + (percent / 100) * 255)));
      return '#' + [f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
    } catch (e) { return hex; }
  }
  function hexAlpha(hex, a) {
    try {
      const { r, g, b } = hexToRgb(hex);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    } catch (e) { return 'rgba(47,158,222,' + a + ')'; }
  }

  /* --------------------------- GitHub (users.txt) --------------------------- */
  const github = {
    repo: 'Kito-tm/Messenger',
    file: 'users.txt',
    token() { return storage.get(KEY.gh) || ''; },
    setToken(t) { if (t) storage.set(KEY.gh, t.trim()); else storage.del(KEY.gh); },
    async commit(content, message) {
      const token = github.token();
      if (!token) return { ok: false, reason: 'no-token' };
      const base = 'https://api.github.com/repos/' + github.repo + '/contents/' + github.file;
      const headers = { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' };
      let sha = null;
      try {
        const head = await fetch(base, { headers, cache: 'no-store' });
        if (head.ok) sha = (await head.json()).sha || null;
      } catch (e) {}
      const body = {
        message: message || 'Kitogram: обновление users.txt',
        content: btoa(unescape(encodeURIComponent(content))),
        committer: { name: 'Kitogram', email: 'kitogram@users.noreply.github.com' }
      };
      if (sha) body.sha = sha;
      const res = await fetch(base, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });
      if (!res.ok) return { ok: false, reason: 'HTTP ' + res.status };
      return { ok: true, url: 'https://github.com/' + github.repo + '/blob/main/' + github.file };
    }
  };

  /* --------------------------- прочее --------------------------- */
  const download = (filename, content, type) => {
    const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  };

  const copyText = (text) => {
    const done = () => toast('Скопировано');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Не удалось скопировать', true); }
      ta.remove();
    }
  };

  /* настройки хранятся и в аккаунте: при входе с другого устройства всё переезжает */
  const SettingsSync = {
    timer: null,
    push(s) {
      if (!S.uid) return;
      clearTimeout(SettingsSync.timer);
      SettingsSync.timer = setTimeout(() => {
        if (!S.uid) return;
        api.put('accounts/' + enc(S.uid) + '/settings', s).catch(() => {});
      }, 1500);
    },
    async pull() {
      if (!S.uid) return;
      try {
        const remote = await api.get('accounts/' + enc(S.uid) + '/settings');
        if (remote && typeof remote === 'object') applySettings(remote, { local: true });
      } catch (e) {}
    }
  };

  S.settings = applySettings(storage.json(KEY.settings, {}), { local: true });

  return {
    DB, VERSION, SCHEMA, GLOBAL_KEY, COLORS, KEY, DEFAULTS, gradients,
    $, $$, storage, escapeHTML, hashStr, uidColor, avatarFallback, enc, dec,
    now, newId, formatTime, formatDay, formatListTime, formatDuration, plural, dayKey,
    debounce, throttle, mq, isTouch, sha256, makeRecoveryCode, randomCode,
    toast, openModal, closeModal, closeAllModals, closePopovers, setImg,
    api, bus, S, live, media, sound, effects, applySettings, SettingsSync,
    shade, hexAlpha, github, download, copyText
  };
})();
