/* =========================================================================
   Kitogram 4.0 — запуск: экран входа, регистрация, восстановление, сессия
   ========================================================================= */
(function (KG) {
  'use strict';

  const { $, $$, S, storage, KEY, bus } = KG;

  const REQUIRED = [
    'splash', 'auth-screen', 'auth-form-login', 'li-login', 'li-pass', 'li-submit', 'li-error',
    'auth-form-register', 'rg-avatar-btn', 'rg-name', 'rg-login', 'rg-pass', 'rg-pass2', 'rg-submit', 'rg-error',
    'auth-form-recover', 'rc-login', 'rc-code', 'rc-pass', 'rc-submit', 'rc-error',
    'app', 'chat-list', 'chat-search', 'messages', 'composer', 'message-input', 'send-btn',
    'chat-title', 'chat-sub', 'composer-area', 'toasts', 'ctx-menu', 'drawer',
    'profile-modal', 'pe-cover', 'pe-avatar-btn', 'pe-name', 'pe-cover-file', 'profile-save',
    'card-modal', 'card-cover', 'card-name', 'card-actions',
    'settings-modal', 'set-accent', 'set-theme',
    'newchat-modal', 'newchat-search', 'newchat-list', 'group-modal', 'new-group-members',
    'info-modal', 'info-body', 'image-modal', 'video-modal', 'attach-menu'
  ];

  let regAvatar = '';
  let busy = false;

  const hideSplash = () => {
    const el = $('splash');
    if (!el || el.classList.contains('fade')) return;
    el.classList.add('fade');
    setTimeout(() => el.classList.add('hidden'), 300);
  };

  const showAuth = (tab) => {
    hideSplash();
    $('app').classList.add('hidden');
    $('auth-screen').classList.remove('hidden');
    AuthUI.switchTab(tab || 'login');
  };

  const AuthUI = {
    switchTab(tab) {
      $$('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.authTab === tab));
      $('auth-form-login').classList.toggle('hidden', tab !== 'login');
      $('auth-form-register').classList.toggle('hidden', tab !== 'register');
      $('auth-form-recover').classList.toggle('hidden', tab !== 'recover');
    },
    error(form, msg) {
      const el = $(form === 'register' ? 'rg-error' : form === 'recover' ? 'rc-error' : 'li-error');
      if (!el) return;
      el.textContent = msg || '';
      el.classList.toggle('hidden', !msg);
    },
    busy(form, on, label) {
      const map = { login: 'li-submit', register: 'rg-submit', recover: 'rc-submit' };
      const btn = $(map[form]);
      if (!btn) return;
      btn.disabled = on;
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.textContent = on ? (label || 'Подождите…') : btn.dataset.label;
    },

    async doLogin() {
      AuthUI.error('login', '');
      const login = KG.Auth.clean($('li-login').value);
      const pass = $('li-pass').value;
      const err = KG.Auth.validate(login) || (pass ? '' : 'Введите пароль');
      if (err) { AuthUI.error('login', err); return; }
      if (!navigator.onLine) { AuthUI.error('login', 'Нет подключения к интернету'); return; }
      AuthUI.busy('login', true, 'Входим…');
      try {
        const res = await KG.Auth.login(login, pass);
        KG.Auth.saveSession(res.uid, pass, $('li-remember').checked);
        await AuthUI.enter(res.uid, res.people);
      } catch (e) {
        AuthUI.error('login', e.message || 'Не удалось войти');
      } finally { AuthUI.busy('login', false); }
    },

    async doRegister() {
      AuthUI.error('register', '');
      const data = {
        name: $('rg-name').value.trim(),
        login: KG.Auth.clean($('rg-login').value),
        password: $('rg-pass').value,
        password2: $('rg-pass2').value,
        avatar: regAvatar
      };
      const err = KG.Auth.validate(data.login) || KG.Auth.validatePassword(data.password);
      if (err) { AuthUI.error('register', err); return; }
      if (data.password !== data.password2) { AuthUI.error('register', 'Пароли не совпадают'); return; }
      if (!navigator.onLine) { AuthUI.error('register', 'Нет подключения к интернету'); return; }
      AuthUI.busy('register', true, 'Создаём аккаунт…');
      try {
        const res = await KG.Auth.register(data);
        KG.Auth.saveSession(res.uid, data.password, true);
        $('li-login').value = data.login;
        await AuthUI.enter(res.uid, res.people);
        setTimeout(() => {
          KG.toast('Аккаунт создан. Код восстановления: ' + res.recoveryCode);
          if (S.self && S.self.recoveryCode) {
            showRecoverySheet(res.recoveryCode);
          }
        }, 500);
      } catch (e) {
        AuthUI.error('register', e.message || 'Не удалось зарегистрироваться');
      } finally { AuthUI.busy('register', false); }
    },

    async doRecover() {
      AuthUI.error('recover', '');
      AuthUI.busy('recover', true, 'Меняем пароль…');
      try {
        const res = await KG.Auth.recover($('rc-login').value, $('rc-code').value, $('rc-pass').value);
        AuthUI.error('recover', '');
        KG.toast('Пароль изменён — теперь войдите с новым паролем');
        $('li-login').value = KG.Auth.clean($('rc-login').value);
        $('li-pass').value = '';
        AuthUI.switchTab('login');
      } catch (e) {
        AuthUI.error('recover', e.message || 'Не удалось восстановить');
      } finally { AuthUI.busy('recover', false); }
    },

    async enter(uid, people) {
      S.uid = uid;
      await KG.Auth.startSession(uid);
      $('auth-screen').classList.add('hidden');
      $('app').classList.remove('hidden');
      KG.Drawer.render();
      KG.List.render();
      KG.Header.render();
      KG.UI.netStatus();
      KG.Messages.updateSendButton();
      KG.live.start();
      // список людей — сразу через REST, не дожидаясь потока
      if (KG.People && KG.People.boot) KG.People.boot();
      setTimeout(() => {
        // подтянуть свежий people/medа и старые диалоги
        KG.People.load(uid);
        KG.media.fetchUserMedia(uid).then((m) => {
          if (m) { S.mediaSelf = Object.assign({}, S.mediaSelf, m); }
          KG.Drawer.render(); KG.List.render();
        });
      }, 200);
    }
  };

  /* лист с кодом восстановления */
  const showRecoverySheet = (code) => {
    const old = $('recovery-sheet');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'recovery-sheet';
    el.className = 'recovery-sheet';
    el.innerHTML =
      '<div class="rs-card">' +
        '<div class="rs-title">Сохраните код восстановления</div>' +
        '<p class="rs-text">Если забудете пароль, с ним можно задать новый. Код также лежит в <b>users.txt</b> в репозитории.</p>' +
        '<code class="rs-code">' + KG.escapeHTML(code) + '</code>' +
        '<div class="rs-actions">' +
          '<button type="button" class="btn btn-secondary" id="rs-copy">Скопировать</button>' +
          '<button type="button" class="btn btn-primary" id="rs-ok">Готово</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('#rs-copy').addEventListener('click', () => KG.copyText(code));
    el.querySelector('#rs-ok').addEventListener('click', () => el.remove());
    el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
  };

  /* ---------------- обработчики экрана входа ---------------- */
  const bindAuth = () => {
    $$('.auth-tab').forEach((t) => t.addEventListener('click', () => AuthUI.switchTab(t.dataset.authTab)));
    $('auth-form-login').addEventListener('submit', (e) => { e.preventDefault(); AuthUI.doLogin(); });
    $('auth-form-register').addEventListener('submit', (e) => { e.preventDefault(); AuthUI.doRegister(); });
    $('auth-form-recover').addEventListener('submit', (e) => { e.preventDefault(); AuthUI.doRecover(); });
    $('li-forgot').addEventListener('click', () => { AuthUI.switchTab('recover'); $('rc-login').value = KG.Auth.clean($('li-login').value); });
    $('rc-back').addEventListener('click', () => AuthUI.switchTab('login'));

    $('rg-avatar-btn').addEventListener('click', () => $('rg-avatar-file').click());
    $('rg-avatar-file').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        if (/^image\/gif$/i.test(f.type)) {
          const data = await KG.media.dataUrl(f);
          if (data.length > 400000) { KG.toast('GIF-аватар слишком большой (до ~300 КБ)', true); return; }
          regAvatar = data;
        } else regAvatar = await KG.media.imageToDataURL(f, 320, 0.85);
        $('rg-avatar').src = regAvatar;
      } catch (err) { KG.toast('Не удалось обработать фото', true); }
    });
    $('rg-login').addEventListener('input', (e) => {
      const v = KG.Auth.clean(e.target.value);
      if (!regAvatar) $('rg-avatar').src = KG.avatarFallback(v || 'K', v || 'reg');
    });

    // «глаз» на пароли — по клику на label не нужно; быстрый ввод логина в нижнем регистре
    ['li-login', 'rg-login'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('blur', () => { el.value = KG.Auth.clean(el.value); });
    });
  };

  /* ---------------- восстановление сессии ---------------- */
  const restore = async () => {
    const uid = storage.get(KEY.uid);
    if (!uid) { showAuth('login'); return; }
    try {
      await KG.Auth.startSession(uid);
      $('auth-screen').classList.add('hidden');
      $('app').classList.remove('hidden');
      hideSplash();
      KG.Drawer.render();
      KG.List.render();
      KG.Header.render();
      KG.UI.netStatus();
      KG.Messages.updateSendButton();
      KG.live.start();
      if (KG.People && KG.People.boot) KG.People.boot();
      KG.media.fetchUserMedia(uid).then((m) => { if (m) S.mediaSelf = Object.assign({}, S.mediaSelf, m); });
    } catch (e) {
      KG.Auth.clearSession();
      showAuth('login');
    }
  };

  /* ---------------- старт ---------------- */
  const boot = () => {
    const missing = REQUIRED.filter((id) => !$(id));
    if (missing.length) console.error('Kitogram: нет элементов —', missing);

    bindAuth();
    KG.UI.bind();
    KG.messagesBind();
    KG.GroupsUI.bind();
    KG.Profile.bind();
    KG.Settings.bind();
    KG.NewChat.bind();

    $('rg-avatar').src = KG.avatarFallback('K', 'reg');
    KG.UI.syncSettingsControls();
    KG.UI.netStatus();

    KG.bus.on('chat', (chatId) => {
      const s = storage.json(KEY.drafts, {});
      S.drafts = s;
    });
    S.drafts = storage.json(KEY.drafts, {});

    restore();

    window.addEventListener('online', () => { if (S.uid) KG.Auth.presenceLoop(); });
    window.addEventListener('pagehide', () => { KG.Auth.goOffline(); });
    window.addEventListener('beforeunload', () => { KG.Auth.goOffline(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && S.activeChat && S.uid) {
        if (S.activeChat === KG.GLOBAL_KEY) return;
        if (S.activeChat.indexOf('group_') === 0) KG.Groups.markRead(S.activeChat);
        else KG.Chat.markRead(S.activeChat);
        KG.List.render();
      }
    });

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));
    }

    setTimeout(() => {
      const sp = $('splash');
      if (sp && !sp.classList.contains('fade')) { hideSplash(); showAuth('login'); }
    }, 6000);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  KG.AuthUI = AuthUI;
})(window.KG);
