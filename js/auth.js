/* =========================================================================
   Kitogram 4.0 — вход, регистрация, восстановление, сессия, присутствие
   ========================================================================= */
(function (KG) {
  'use strict';

  const { $, enc, now, S, api, storage, KEY, bus } = KG;

  const LOGIN_RE = /^[a-zA-Z0-9_.\-]{3,24}$/;
  const RESERVED = ['global', 'system', 'admin', 'kitogram', 'support'];

  const Auth = {
    /* ---------- нормализация ---------- */
    clean(raw) {
      let v = String(raw || '').trim().replace(/^@+/, '');
      v = v.replace(/\s+/g, '_');
      return v;
    },
    validate(login) {
      if (!login) return 'Введите логин';
      if (login.length < 3) return 'Логин короче 3 символов';
      if (login.length > 24) return 'Логин длиннее 24 символов';
      if (!LOGIN_RE.test(login)) return 'Только латиница, цифры и _ . -';
      if (RESERVED.indexOf(login.toLowerCase()) !== -1) return 'Этот логин зарезервирован';
      return '';
    },
    validatePassword(pw) {
      if (!pw) return 'Введите пароль';
      if (String(pw).length < 6) return 'Пароль минимум 6 символов';
      if (String(pw).length > 64) return 'Слишком длинный пароль';
      return '';
    },
    uidOf(login) { return '@' + String(login || '').replace(/^@+/, ''); },

    async exists(uid) {
      try {
        const v = await api.get('people/' + enc(uid));
        if (v) return true;
        // логины регистронезависимы: @Kito_God и @kito_god — один аккаунт
        const bare = String(uid).replace(/^@+/, '').toLowerCase();
        const list = await api.get('people', { shallow: 'true' });
        return Object.keys(list || {}).some((k) => k.replace(/^@+/, '').toLowerCase() === bare);
      } catch (e) { return false; }
    },

    /* ---------- users.txt ---------- */
    async readUsersTxt() {
      const { github } = KG;
      const token = github.token();
      const headers = token ? { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' } : {};
      try {
        const res = await fetch('https://api.github.com/repos/' + github.repo + '/contents/' + github.file + '?ref=main', { headers, cache: 'no-store' });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || !data.content) return null;
        const raw = atob(String(data.content).replace(/\s/g, ''));
        let text = raw;
        try { text = decodeURIComponent(escape(raw)); } catch (e) {}
        return { text, sha: data.sha };
      } catch (e) { return null; }
    },

    usersTxtLine(rec) {
      return [
        rec.login, 'pass=' + rec.password, 'code=' + rec.code,
        'name="' + String(rec.name || '').replace(/"/g, '') + '"',
        'created=' + new Date(rec.createdAt || now()).toISOString().slice(0, 19).replace('T', ' ')
      ].join('  ');
    },

    async appendUsersTxt(rec) {
      const { github } = KG;
      let text = '';
      const head = await Auth.readUsersTxt();
      if (head && head.text) text = head.text;
      if (!text) {
        text = [
          'Kitogram — список аккаунтов (логины и пароли для восстановления доступа)',
          'Формат строки:  @логин  pass=пароль  code=код-восстановления  name="имя"  created=дата',
          '----------------------------------------',
          ''
        ].join('\n');
      }
      const marker = ' ' + rec.login + '  pass=';
      const lines = text.split('\n').filter((l) => l.indexOf(marker) === -1);
      lines.push(Auth.usersTxtLine(rec));
      const next = lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
      const res = await github.commit(next, 'Kitogram: регистрация ' + rec.login);
      if (!res.ok) console.warn('users.txt: не удалось обновить GitHub —', res.reason);
      // всегда держим копию в базе (доступна через /users.txt.json)
      try { await api.put('users_txt/' + enc(rec.login), { line: Auth.usersTxtLine(rec), ts: now() }); } catch (e) {}
      try { storage.set('kg_users_txt', next); } catch (e) {}
      return res;
    },

    async buildUsersTxtFromDB(users) {
      const lines = [
        'Kitogram — список аккаунтов (логины и пароли для восстановления доступа)',
        'Формат строки:  @логин  pass=пароль  code=код-восстановления  name="имя"  created=дата',
        '----------------------------------------',
        ''
      ];
      const keys = Object.keys(users || {}).sort();
      keys.forEach((uid) => {
        const u = users[uid] || {};
        if (!u.login) return;
        const at = '@' + String(u.login).replace(/^@+/, '');
        lines.push(Auth.usersTxtLine({
          login: at,
          password: u.recoveryPass || '—',
          code: u.recoveryCode || '—',
          name: u.displayName || u.name || '',
          createdAt: u.createdAt
        }));
      });
      return lines.join('\n') + '\n';
    },

    /* ---------- регистрация ---------- */
    async register(opts) {
      const login = Auth.clean(opts.login).toLowerCase();
      const err = Auth.validate(login);
      if (err) throw new Error(err);
      const pwErr = Auth.validatePassword(opts.password);
      if (pwErr) throw new Error(pwErr);
      if (opts.password !== opts.password2) throw new Error('Пароли не совпадают');
      // канонический uid = нижний регистр, чтобы не появлялись @Kito_god и @kito_god
      const uid = Auth.uidOf(login);
      if (await Auth.exists(uid)) throw new Error('Логин @' + login + ' уже занят');
      if (RESERVED.indexOf(login.toLowerCase()) !== -1) throw new Error('Этот логин зарезервирован');

      const salt = KG.makeRecoveryCode().slice(3, 11);
      const passwordHash = await KG.sha256('kg$' + salt + '$' + login.toLowerCase() + '$' + opts.password);
      const recoveryCode = KG.makeRecoveryCode();
      const recoveryHash = await KG.sha256('rc$' + recoveryCode);
      const ts = now();
      const name = String(opts.name || '').trim().slice(0, 32) || login;
      const color = KG.uidColor(uid);
      const avatar = opts.avatar || '';

      const people = {
        uid, login, displayName: name, name,
        avatarThumb: avatar || '',
        color,
        frame: 'none', badge: '', era: 'classic',
        coverType: 'gradient', coverPreset: 'aurora', coverDim: 24, coverBlur: false,
        createdAt: ts, lastSeen: ts, online: true, schema: KG.SCHEMA
      };
      const account = {
        uid, login, name, createdAt: ts, schema: KG.SCHEMA,
        passwordHash, salt, recoveryCode, recoveryHash,
        recoveryPass: opts.password,          // только для users.txt / восстановления
        avatar: avatar || ''
      };
      await Promise.all([
        api.put('people/' + enc(uid), people),
        api.put('accounts/' + enc(uid), account)
      ]);
      if (avatar) {
        try { await api.put('media/' + enc(uid), { avatar }); } catch (e) {}
      }
      // users.txt: GitHub (если есть токен) + копия в базе
      try {
        await Auth.appendUsersTxt({
          login: uid, password: opts.password, code: recoveryCode, name, createdAt: ts
        });
      } catch (e) { console.warn('users.txt', e); }

      return { uid, passwordHash, salt, recoveryCode, name, avatar, color, people, account };
    },

    /* ---------- вход ---------- */
    async login(rawLogin, password) {
      // логин регистронезависимый: ищем точное совпадение, иначе — по нижнему регистру
      const raw = Auth.clean(rawLogin);
      const candidates = [raw];
      if (!(await KG.api.get('people/' + enc('@' + raw)))) {
        try {
          const list = await KG.api.get('people', { shallow: 'true' });
          const hit = Object.keys(list || {}).find((k) => k.replace(/^@+/, '').toLowerCase() === raw.toLowerCase());
          if (hit) candidates.unshift(hit.replace(/^@+/, ''));
        } catch (e) {}
      }
      const login = candidates[0];
      const verr = Auth.validate(login);
      if (verr) throw new Error(verr);
      if (!password) throw new Error('Введите пароль');
      let uid = Auth.uidOf(login);
      let acc = await api.get('accounts/' + enc(uid));

      // ---- старый аккаунт из схемы 3.0 (users/<ключ>) ----
      if (!acc) {
        const legacy = await Auth.findLegacy(login);
        if (legacy) {
          const migrated = await Auth.migrateLegacy(legacy.key, login, password);
          if (!migrated) throw Object.assign(new Error('Неверный пароль'), { code: 'BAD_PASS' });
          uid = migrated.uid;
          acc = migrated.acc;
        }
      }
      if (!acc) throw new Error('Аккаунт @' + login + ' не найден. Зарегистрируйтесь!');
      const salt = acc.salt || '';
      const hash = await KG.sha256('kg$' + salt + '$' + login.toLowerCase() + '$' + password);
      const legacyOk = acc.passwordHash && acc.passwordHash === (await KG.sha256(password));
      if (acc.passwordHash && hash !== acc.passwordHash && !legacyOk) {
        const e = new Error('Неверный пароль');
        e.code = 'BAD_PASS';
        throw e;
      }
      if (acc.recoveryPass && acc.recoveryPass !== password && acc.passwordHash === hash) {
        // пароль совпал по хешу, но в users.txt устарел — обновим файл
      }
      const people = await api.get('people/' + enc(uid));
      return { uid, acc, people: people || null, password };
    },

    /* ---------- старые аккаунты (3.0) ---------- */
    async findLegacy(login) {
      const bare = String(login).replace(/^@+/, '').toLowerCase();
      try {
        const keys = await api.get('users', { shallow: 'true' });
        const raw = Object.keys(keys || {});
        const pick = (pred) => raw.find(pred);
        const bareOf = (k) => String(k).replace(/^@+/, '');
        const key = pick((k) => bareOf(k) === bare && String(k).charAt(0) === '@')
          || pick((k) => bareOf(k) === bare)
          || pick((k) => bareOf(k).toLowerCase() === bare.toLowerCase() && String(k).charAt(0) === '@')
          || pick((k) => bareOf(k).toLowerCase() === bare.toLowerCase());
        if (!key) return null;
        const data = await api.get('users/' + enc(key));
        return { key, data };
      } catch (e) { return null; }
    },

    async migrateLegacy(key, login, password) {
      const data = await api.get('users/' + enc(key));
      if (!data) return null;
      const stored = data.password != null ? String(data.password) : '';
      const hashPlain = await KG.sha256(password);
      if (stored && stored !== password && stored !== hashPlain) return null;
      if (!stored && data.passwordHash && data.passwordHash !== hashPlain) return null;

      const bare = String(login).replace(/^@+/, '').toLowerCase();
      const uid = '@' + bare;
      const salt = KG.makeRecoveryCode().slice(3, 11);
      const passwordHash = await KG.sha256('kg$' + salt + '$' + bare + '$' + password);
      const recoveryCode = KG.makeRecoveryCode();
      const ts = now();
      const name = data.displayName || data.nickname || bare;
      const avatar = data.avatar || '';
      const color = data.userColor || data.color || KG.uidColor(uid);
      const acc = {
        uid, login: bare, name, createdAt: data.createdAt || ts, schema: KG.SCHEMA,
        passwordHash, salt, recoveryCode, recoveryHash: await KG.sha256('rc$' + recoveryCode),
        recoveryPass: password, avatar, migratedFrom: '3.0'
      };
      const people = {
        uid, login: bare, displayName: name, name,
        avatarThumb: avatar && avatar.length < 90000 ? avatar : '',
        color, frame: 'none', badge: '', era: 'classic',
        coverType: 'gradient', coverPreset: 'aurora', coverDim: 24, coverBlur: false,
        createdAt: acc.createdAt, lastSeen: ts, online: true, schema: KG.SCHEMA
      };
      await Promise.all([
        api.put('accounts/' + enc(uid), acc),
        api.put('people/' + enc(uid), people)
      ]);
      if (avatar) { try { await api.put('media/' + enc(uid), { avatar }); } catch (e) {} }
      try {
        await Auth.appendUsersTxt({ login: uid, password, code: recoveryCode, name, createdAt: acc.createdAt });
      } catch (e) {}
      return { uid, acc, people };
    },

    /* ---------- восстановление ---------- */
    async recover(rawLogin, code, newPass) {
      let login = Auth.clean(rawLogin);
      try {
        if (!(await KG.api.get('people/' + enc('@' + login)))) {
          const list = await KG.api.get('people', { shallow: 'true' });
          const hit = Object.keys(list || {}).find((k) => k.replace(/^@+/, '').toLowerCase() === login.toLowerCase());
          if (hit) login = hit.replace(/^@+/, '');
        }
      } catch (e) {}
      const uid = Auth.uidOf(login);
      const verr = Auth.validate(login);
      if (verr) throw new Error(verr);
      const pwErr = Auth.validatePassword(newPass);
      if (pwErr) throw new Error(pwErr);
      if (!code) throw new Error('Введите код восстановления');
      const acc = await api.get('accounts/' + enc(uid));
      if (!acc) throw new Error('Аккаунт @' + login + ' не найден');
      const codeHash = await KG.sha256('rc$' + String(code).trim().toUpperCase());
      if (!acc.recoveryHash || (codeHash !== acc.recoveryHash && String(code).trim().toUpperCase() !== String(acc.recoveryCode || '').toUpperCase())) {
        throw new Error('Код восстановления неверный');
      }
      const salt = acc.salt || '';
      const passwordHash = await KG.sha256('kg$' + salt + '$' + login.toLowerCase() + '$' + newPass);
      await api.patch('accounts/' + enc(uid), { passwordHash, recoveryPass: newPass });
      try {
        await Auth.appendUsersTxt({
          login: uid, password: newPass, code: acc.recoveryCode || code, name: acc.name || login, createdAt: acc.createdAt
        });
      } catch (e) {}
      return { uid, password: newPass };
    },

    /* ---------- сессия ---------- */
    saveSession(uid, password, remember) {
      if (remember) {
        storage.set(KEY.uid, uid);
        // храним не пароль, а хеш-доказательство, чтобы пережить перезагрузку
        storage.set(KEY.auth, String(password));
      } else {
        storage.del(KEY.uid);
        storage.del(KEY.auth);
      }
    },
    clearSession() {
      [KEY.uid, KEY.auth, KEY.name, KEY.avatar].forEach((k) => storage.del(k));
    },

    async startSession(uid) {
      S.uid = uid;
      const [acc, people] = await Promise.all([
        api.get('accounts/' + enc(uid)),
        api.get('people/' + enc(uid))
      ]);
      if (!acc) throw new Error('Аккаунт не найден');
      S.self = acc;
      S.me = people || { uid, login: acc.login || uid, displayName: acc.name || acc.login };
      S.me.avatarThumb = S.me.avatarThumb || acc.avatar || '';
      S.mediaSelf = { avatar: acc.avatar || '', cover: acc.cover || '', coverPoster: acc.coverPoster || '' };
      // нормализуем ник: один @ в публичном поле
      if (S.me.login && S.me.login.indexOf('@') !== 0) S.me.login = '@' + String(S.me.login).replace(/^@+/, '');
      if (!S.me.displayName) S.me.displayName = S.me.login.replace(/^@/, '');
      const settings = KG.storage.json(KEY.settings, {});
      S.settings = KG.applySettings(settings);
      S.typingHidden = !!S.settings.hideTyping;
      S.media = {};
      S.groupMsgs = {};
      S.nodes.acc = { chats: {}, messages: {}, read: {} };
      S.nodes.inbox = {};
      S.nodes.typing = {};
      if (KG.resetInbox) KG.resetInbox();
      S.hiddenMsgs = KG.storage.json(KEY.hiddenMsgs, {});
      S.hidden = KG.storage.json(KEY.hidden, {});
      S.muted = KG.storage.json(KEY.muted, {});
      S.pinned = KG.storage.json(KEY.pinned, {});
      S.ready = true;
      // тянем read из аккаунта (чтобы непрочитанные не «сбрасывались» на новом телефоне)
      try {
        const read = await api.get('accounts/' + enc(uid) + '/read');
        if (read) S.nodes.acc.read = read;
      } catch (e) {}
      // перезапускаем realtime-потоки под новый аккаунт
      try { KG.live.stop(); } catch (e) {}
      S.channelReady = false;
      bus.emit('session', uid);
      Auth.presenceLoop();
      KG.SettingsSync.pull();
      return { acc: S.self, me: S.me };
    },

    presenceLoop() {
      clearInterval(Auth._presence);
      const push = async () => {
        if (!S.uid) return;
        const ts = now();
        try {
          await api.patch('people/' + enc(S.uid), { online: true, lastSeen: ts });
          await api.put('status/' + enc(S.uid), { online: true, ts });
        } catch (e) {}
      };
      push();
      Auth._presence = setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        push();
      }, 45000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') push();
      });
    },

    async goOffline() {
      if (!S.uid) return;
      const ts = now();
      try {
        if (navigator.sendBeacon) {
          const body = new Blob([JSON.stringify({ online: false, lastSeen: ts })], { type: 'application/json' });
          navigator.sendBeacon(api.url('people/' + enc(S.uid)) + '&method=patch', body);
        } else {
          await api.patch('people/' + enc(S.uid), { online: false, lastSeen: ts });
        }
      } catch (e) {}
      try { await api.put('status/' + enc(S.uid), { online: false, ts }); } catch (e) {}
    },

    async logout() {
      if (!confirm('Выйти из аккаунта на этом устройстве? Переписки останутся в аккаунте и вернутся при следующем входе.')) return;
      await Auth.goOffline();
      try { KG.live.stop(); } catch (e) {}
      Auth.clearSession();
      setTimeout(() => location.reload(), 120);
    }
  };

  KG.Auth = Auth;
})(window.KG);
