/* =========================================================================
   Kitogram 4.0 — оформление и настройки
   ========================================================================= */
(function (KG) {
  'use strict';

  const { $, enc, S, escapeHTML, bus, storage } = KG;

  const ACCENTS = ['#2f9ede', '#a855f7', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#8b5cf6', '#84cc16', '#f97316'];
  const WALLS = ['none', 'aurora', 'sunset', 'ocean', 'mint', 'neon', 'graphite', 'candy', 'lava', 'forest', 'midnight'];

  const Settings = {
    open() {
      const tok = $('set-gh-token');
      if (tok) tok.value = KG.github.token() ? '••••••••' : '';
      Settings.paintAccents();
      Settings.paintWalls();
      KG.UI.syncSettingsControls();
      KG.openModal('settings-modal');
    },

    paintAccents() {
      const box = $('set-accent');
      box.innerHTML = '';
      ACCENTS.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch' + ((S.settings.accent || '').toLowerCase() === c ? ' active' : '');
        b.style.background = c;
        b.title = c;
        b.addEventListener('click', () => {
          KG.applySettings({ accent: c });
          Settings.paintAccents();
        });
        box.appendChild(b);
      });
    },

    paintWalls() {
      const box = $('set-wall-presets');
      box.innerHTML = '';
      WALLS.forEach((k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wall-preset' + ((S.settings.wallPreset || 'none') === k && !S.settings.wallpaper ? ' active' : '');
        b.style.background = k === 'none' ? 'var(--bg)' : KG.gradients[k];
        b.title = k;
        if (k === 'none') b.textContent = 'нет';
        b.addEventListener('click', () => {
          KG.applySettings({ wallPreset: k, wallpaper: '' });
          Settings.paintWalls();
        });
        box.appendChild(b);
      });
    },

    bind() {
      $('set-theme').addEventListener('change', (e) => KG.applySettings({ theme: e.target.value }));
      $('set-bubble').addEventListener('change', (e) => KG.applySettings({ bubble: e.target.value }));
      $('set-font').addEventListener('input', (e) => KG.applySettings({ font: Number(e.target.value) }));
      $('set-wall-dim').addEventListener('input', (e) => KG.applySettings({ wallDim: Number(e.target.value) }));
      $('set-sound').addEventListener('change', (e) => KG.applySettings({ sound: e.target.checked }));
      $('set-effects').addEventListener('change', (e) => KG.applySettings({ effects: e.target.checked }));
      $('set-typing-hidden').addEventListener('change', (e) => {
        KG.applySettings({ hideTyping: e.target.checked });
        S.typingHidden = e.target.checked;
      });
      $('set-wall-file').addEventListener('click', () => $('set-wall-input').click());
      $('set-wall-input').addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        try {
          KG.toast('Готовим обои…');
          let src;
          if (/^image\/gif$/i.test(f.type)) src = await KG.media.dataUrl(f);
          else src = await KG.media.imageToDataURL(f, 1600, 0.8);
          if (src.length > 2200000) { KG.toast('Файл слишком большой (до ~1,6 МБ)', true); return; }
          KG.applySettings({ wallpaper: src, wallPreset: 'none' });
          Settings.paintWalls();
          KG.toast('Обои установлены');
        } catch (err) { KG.toast('Не удалось установить обои', true); }
      });
      $('set-wall-clear').addEventListener('click', () => {
        KG.applySettings({ wallpaper: '', wallPreset: 'none' });
        Settings.paintWalls();
      });

      $('set-export').addEventListener('click', async () => {
        const btn = $('set-export');
        btn.disabled = true;
        try {
          KG.toast('Собираем users.txt…');
          const users = await KG.api.get('accounts', { shallow: 'true' });
          let text = storage.get('kg_users_txt') || '';
          if (users) {
            const full = {};
            await Promise.all(Object.keys(users).map(async (k) => {
              try { full[k] = await KG.api.get('accounts/' + enc(k)); } catch (e) {}
            }));
            text = await KG.Auth.buildUsersTxtFromDB(full);
          }
          if (!text) { KG.toast('Пока нет зарегистрированных аккаунтов', true); return; }
          KG.download('users.txt', text);
          const gh = await KG.Auth.readUsersTxt();
          if (gh) KG.toast('users.txt скачан. В репозитории файл тоже обновляется автоматически.');
          else KG.toast('users.txt скачан');
        } catch (e) { KG.toast('Не удалось собрать users.txt', true); }
        finally { btn.disabled = false; }
      });

      const ghSave = $('set-gh-save');
      if (ghSave) ghSave.addEventListener('click', () => {
        const v = $('set-gh-token').value.trim();
        if (!v || v === '••••••••') { KG.toast('Вставьте токен GitHub', true); return; }
        if (!/^(ghp_|github_pat_|gho_)/.test(v)) { KG.toast('Похоже, это не токен GitHub', true); return; }
        KG.github.setToken(v);
        $('set-gh-token').value = '••••••••';
        KG.toast('Токен сохранён в этом браузере');
      });
      const ghPush = $('set-gh-push');
      if (ghPush) ghPush.addEventListener('click', async () => {
        if (!KG.github.token()) { KG.toast('Сначала сохраните GitHub-токен', true); return; }
        ghPush.disabled = true;
        try {
          KG.toast('Собираем users.txt…');
          const users = await KG.api.get('accounts', { shallow: 'true' });
          const full = {};
          await Promise.all(Object.keys(users || {}).map(async (k) => {
            try { full[k] = await KG.api.get('accounts/' + enc(k)); } catch (e) {}
          }));
          const text = await KG.Auth.buildUsersTxtFromDB(full);
          const res = await KG.github.commit(text, 'Kitogram: обновление списка аккаунтов');
          if (res.ok) KG.toast('users.txt обновлён в GitHub');
          else KG.toast('GitHub: ' + res.reason, true);
        } catch (e) { KG.toast('Не удалось отправить файл', true); }
        finally { ghPush.disabled = false; }
      });

      $('set-reset').addEventListener('click', async () => {
        if (!confirm('Сбросить всю базу Kitogram: аккаунты, переписки, группы и общий чат? Это необратимо.')) return;
        if (!confirm('Точно? Все пользователи будут удалены.')) return;
        try {
          KG.toast('Сбрасываем базу…');
          await KG.api.put('/', null);
          ['people', 'accounts', 'media', 'inbox', 'messages', 'chats', 'status', 'typing', 'seen', 'users_txt', 'shared_backgrounds', 'users', 'groups'].forEach((k) => {
            try { localStorage.removeItem(k); } catch (e) {}
          });
          setTimeout(() => { KG.Auth.clearSession(); location.reload(); }, 700);
        } catch (e) { KG.toast('Не удалось сбросить базу', true); }
      });
    }
  };

  KG.Settings = Settings;
})(window.KG);
