/* =========================================================================
   Kitogram 4.0 — профиль и персонализация
   Обложка (картинка / GIF / видео без звука), аватар, рамки, бейджи,
   градиент имени, статус, био, код восстановления, карточка профиля.
   ========================================================================= */
(function (KG) {
  'use strict';

  const { $, enc, now, S, escapeHTML, api, bus } = KG;

  let draft = null;      // черновик изменений
  let coverVideoUrl = '';

  const Profile = {
    /* ---------------- редактор ---------------- */
    openEditor() {
      if (!S.uid) return;
      const me = S.me || {};
      const media = S.mediaSelf || {};
      draft = {
        displayName: me.displayName || me.name || '',
        status: me.status || '',
        bio: me.bio || '',
        frame: me.frame || 'none',
        badge: me.badge || '',
        color: me.color || KG.uidColor(S.uid),
        gradOn: !!me.gradOn,
        gradA: me.gradA || '#2f9ede',
        gradB: me.gradB || '#a855f7',
        cover: {
          type: me.coverType || 'gradient',
          preset: me.coverPreset || 'aurora',
          src: media.cover || '',
          poster: media.coverPoster || '',
          blur: !!me.coverBlur,
          dim: typeof me.coverDim === 'number' ? me.coverDim : 24
        },
        avatar: media.avatar || ''
      };
      Profile.fill();
      KG.openModal('profile-modal');
    },

    fill() {
      const d = draft;
      $('pe-name').value = d.displayName;
      $('pe-status').value = d.status;
      $('pe-bio').value = d.bio;
      $('pe-frame-select').value = d.frame;
      $('pe-badge').value = d.badge;
      $('pe-color').value = d.color;
      $('pe-grad-on').checked = d.gradOn;
      $('pe-grad-a').value = d.gradA;
      $('pe-grad-b').value = d.gradB;
      $('pe-cover-dim').value = d.cover.dim;
      $('pe-cover-blur').checked = d.cover.blur;
      $('pe-recovery').textContent = '••••••••';
      $('pe-recovery-show').textContent = 'Показать';
      const av = $('pe-avatar');
      av.src = d.avatar || KG.avatarFallback(d.displayName || 'K', S.uid);
      const frame = $('pe-frame');
      frame.className = 'frame frame-' + d.frame;
      Profile.paintCover();
      Profile.paintPresets();
      Profile.syncGradRow();
    },

    syncGradRow() {
      const row = $('pe-grad-row');
      if (row) row.classList.toggle('disabled', !$('pe-grad-on').checked);
    },

    paintPresets() {
      const box = $('pe-cover-presets');
      if (!box) return;
      box.innerHTML = '';
      Object.keys(KG.gradients).forEach((k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cover-preset' + (draft.cover.type === 'gradient' && draft.cover.preset === k ? ' active' : '');
        b.style.background = KG.gradients[k];
        b.title = k;
        b.addEventListener('click', () => {
          draft.cover = Object.assign({}, draft.cover, { type: 'gradient', preset: k });
          Profile.paintCover(); Profile.paintPresets();
        });
        box.appendChild(b);
      });
    },

    paintCover() {
      const media = $('pe-cover-media');
      const c = draft.cover;
      media.innerHTML = '';
      media.style.filter = '';
      media.className = 'cover-media';
      if (c.src && (c.type === 'video' || c.type === 'gif' || c.type === 'image')) {
        media.style.background = 'linear-gradient(rgba(0,0,0,' + Number(c.dim) / 100 + '),rgba(0,0,0,' + Number(c.dim) / 100 + '))';
        if (c.type === 'video') {
          const v = document.createElement('video');
          v.src = c.src; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
          v.className = 'cover-video';
          media.appendChild(v);
          v.play().catch(() => {});
        } else {
          media.style.background += ',url("' + String(c.src).replace(/"/g, '\\"') + '") center/cover';
        }
        if (c.blur) media.style.filter = 'blur(5px)';
      } else {
        media.style.background = KG.gradients[c.preset] || KG.gradients.aurora;
      }
      $('pe-tint').style.background = 'rgba(0,0,0,' + Number(c.dim) / 100 + ')';
      const frame = $('pe-frame');
      if (frame) frame.className = 'frame frame-' + (draft ? draft.frame : 'none');
    },

    async pickCover(file) {
      if (!file) return;
      KG.toast('Готовим обложку…');
      try {
        const snap = await KG.media.coverFromFile(file, { maxSide: 1280, maxSec: 5 });
        let poster = '';
        if (snap.kind === 'video') poster = await Profile.videoPoster(file);
        draft.cover = Object.assign({}, draft.cover, {
          type: snap.kind, src: snap.src, poster: poster || ''
        });
        Profile.paintCover();
        Profile.paintPresets();
        KG.toast('Обложка готова');
      } catch (e) {
        KG.toast(e.message || 'Не удалось обработать файл', true);
      }
    },

    videoPoster(file) {
      return new Promise((resolve) => {
        try {
          const url = URL.createObjectURL(file);
          const v = document.createElement('video');
          v.src = url; v.muted = true; v.playsInline = true; v.preload = 'metadata';
          v.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
          v.onloadeddata = () => {
            const c = document.createElement('canvas');
            c.width = 640; c.height = 360;
            const ctx = c.getContext('2d');
            try { ctx.drawImage(v, 0, 0, 640, 360); } catch (e) {}
            const out = c.toDataURL('image/jpeg', 0.7);
            URL.revokeObjectURL(url);
            resolve(out);
          };
          v.currentTime = 0.1;
        } catch (e) { resolve(''); }
      });
    },

    async pickAvatar(file) {
      if (!file) return;
      try {
        if (/^image\/gif$/i.test(file.type)) {
          const data = await KG.media.dataUrl(file);
          if (data.length > 700000) { KG.toast('GIF-аватар слишком большой (до ~500 КБ)', true); return; }
          draft.avatar = data;
        } else {
          draft.avatar = await KG.media.imageToDataURL(file, 320, 0.85);
        }
        $('pe-avatar').src = draft.avatar;
        KG.toast('Аватар обновлён — не забудьте сохранить');
      } catch (e) { KG.toast('Не удалось обработать аватар', true); }
    },

    async save() {
      if (!draft) return;
      const name = String($('pe-name').value || '').trim();
      if (!name) { KG.toast('Имя не может быть пустым', true); return; }
      const btn = $('profile-save');
      btn.disabled = true;
      try {
        const people = {
          uid: S.uid,
          login: KG.login(S.uid),
          displayName: name,
          name,
          status: String($('pe-status').value || '').slice(0, 48),
          bio: String($('pe-bio').value || '').slice(0, 160),
          frame: $('pe-frame-select').value,
          badge: $('pe-badge').value,
          color: $('pe-color').value,
          gradOn: $('pe-grad-on').checked,
          gradA: $('pe-grad-a').value,
          gradB: $('pe-grad-b').value,
          coverType: draft.cover.type,
          coverPreset: draft.cover.preset,
          coverBlur: !!draft.cover.blur,
          coverDim: Number(draft.cover.dim) || 0,
          coverPoster: draft.cover.poster || '',
          avatarThumb: draft.avatar && draft.avatar.length < 90000 ? draft.avatar : (S.me.avatarThumb || ''),
          lastSeen: now(),
          online: true
        };
        // тяжёлые медиа — отдельно
        const mediaPatch = {};
        if (draft.avatar) mediaPatch.avatar = draft.avatar;
        mediaPatch.cover = draft.cover.type === 'gradient' ? null : (draft.cover.src || '');
        mediaPatch.coverPoster = draft.cover.poster || '';
        await Promise.all([
          api.patch('people/' + enc(S.uid), people),
          api.patch('accounts/' + enc(S.uid), { name, avatar: draft.avatar || S.mediaSelf.avatar || '' }),
          KG.media.saveUserMedia(S.uid, mediaPatch)
        ]);
        S.me = Object.assign({}, S.me, people);
        S.name = name;
        S.mediaSelf = { avatar: draft.avatar || S.mediaSelf.avatar || '', cover: mediaPatch.cover || '', coverPoster: mediaPatch.coverPoster || '' };
        S.peopleSelfUpdated = true;
        KG.media.cache.set(S.uid, { avatar: S.mediaSelf.avatar, cover: S.mediaSelf.cover, coverPoster: S.mediaSelf.coverPoster });
        KG.Drawer.render();
        KG.List.render();
        KG.Header.render();
        KG.closeModal($('profile-modal'));
        KG.toast('Профиль сохранён ✨');
      } catch (e) {
        KG.toast('Не удалось сохранить профиль', true);
      } finally { btn.disabled = false; }
    },

    onMedia(uid) {
      if (!draft) return;
      if (uid === S.uid) return;
    },

    /* ---------------- карточка профиля ---------------- */
    async openCard(uid) {
      if (!uid || uid === 'system') return;
      if (uid === S.uid) { Profile.openEditor(); return; }
      const body = $('card-modal');
      KG.openModal('card-modal');
      const paint = () => {
        const p = KG.People.get(uid) || {};
        const cover = $('card-cover');
        KG.Cover.render(cover, uid, { className: 'pc-cover' });
        const wrap = $('card-avatar-wrap');
        wrap.className = 'pc-avatar-wrap frame-' + KG.People.frame(uid);
        wrap.innerHTML = '<img class="avatar" id="card-avatar" alt="" src="' + escapeHTML(KG.People.avatar(uid)) + '">' +
          (KG.People.badge(uid) ? '<i class="av-badge">' + escapeHTML(KG.People.badge(uid)) + '</i>' : '');
        $('card-name').innerHTML = KG.Avatar.nameHTML(uid, KG.People.name(uid));
        $('card-login').textContent = KG.login(uid);
        $('card-status').textContent = KG.People.statusText(uid);
        $('card-status').classList.toggle('hidden', !KG.People.statusText(uid));
        $('card-bio').textContent = KG.People.bio(uid);
        $('card-bio').classList.toggle('hidden', !KG.People.bio(uid));
        const meta = [];
        if (KG.People.isOnline(uid)) meta.push('<span class="pill online">в сети</span>');
        else meta.push('<span class="pill">' + escapeHTML(KG.People.lastSeenText(uid)) + '</span>');
        if (p.era) meta.push('<span class="pill">' + escapeHTML(p.era === 'gif' ? 'GIF-легенда' : 'Kitogram') + '</span>');
        $('card-badges').innerHTML = meta.join('');
        const lines = [];
        lines.push('<div class="info-line"><span>Логин</span><span>' + escapeHTML(KG.login(uid)) + '</span></div>');
        if (p.createdAt) lines.push('<div class="info-line"><span>В Kitogram с</span><span>' + escapeHTML(KG.formatDay(p.createdAt)) + '</span></div>');
        const online = KG.People.isOnline(uid);
        lines.push('<div class="info-line"><span>Статус</span><span>' + (online ? 'в сети' : escapeHTML(KG.People.lastSeenText(uid))) + '</span></div>');
        $('card-lines').innerHTML = lines.join('');
        const acts = $('card-actions');
        acts.innerHTML = '';
        const write = document.createElement('button');
        write.type = 'button';
        write.className = 'btn btn-primary btn-block';
        write.textContent = 'Написать';
        write.addEventListener('click', () => { KG.closeAllModals(); KG.ChatUI.open(uid); });
        acts.appendChild(write);
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn btn-secondary btn-block';
        copy.textContent = 'Скопировать @';
        copy.addEventListener('click', () => KG.copyText(KG.login(uid)));
        acts.appendChild(copy);
      };
      paint();
      // подгружаем актуальные данные и тяжёлые медиа
      KG.People.load(uid).then(() => paint());
      KG.media.fetchUserMedia(uid).then(() => paint());
    },

    bind() {
      $('pe-avatar-btn').addEventListener('click', () => $('pe-avatar-file').click());
      $('pe-avatar-file').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        Profile.pickAvatar(f);
      });
      $('pe-cover-btn').addEventListener('click', () => $('pe-cover-file').click());
      $('pe-cover-file').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        Profile.pickCover(f);
      });
      $('pe-cover-clear').addEventListener('click', () => {
        draft.cover = Object.assign({}, draft.cover, { type: 'gradient', src: '', poster: '' });
        Profile.paintCover(); Profile.paintPresets();
      });
      $('pe-cover-blur').addEventListener('change', (e) => {
        draft.cover.blur = e.target.checked;
        Profile.paintCover();
      });
      $('pe-cover-dim').addEventListener('input', (e) => {
        draft.cover.dim = Number(e.target.value);
        $('pe-tint').style.background = 'rgba(0,0,0,' + draft.cover.dim / 100 + ')';
      });
      ['pe-frame-select', 'pe-badge', 'pe-color', 'pe-grad-on', 'pe-grad-a', 'pe-grad-b'].forEach((id) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('input', () => {
          if (id === 'pe-frame-select') { draft.frame = el.value; Profile.paintCover(); }
          if (id === 'pe-badge') draft.badge = el.value;
          if (id === 'pe-color') draft.color = el.value;
          if (id === 'pe-grad-on') Profile.syncGradRow();
        });
        el.addEventListener('change', () => {
          if (id === 'pe-frame-select') { draft.frame = el.value; Profile.paintCover(); }
          if (id === 'pe-grad-on') Profile.syncGradRow();
        });
      });
      $('pe-recovery-show').addEventListener('click', () => {
        const el = $('pe-recovery');
        if (el.dataset.shown === '1') {
          el.textContent = '••••••••'; el.dataset.shown = '0'; $('pe-recovery-show').textContent = 'Показать';
        } else {
          const code = (S.self && S.self.recoveryCode) || '';
          if (!code) { KG.toast('Код восстановления недоступен', true); return; }
          el.textContent = code; el.dataset.shown = '1'; $('pe-recovery-show').textContent = 'Скрыть';
          KG.copyText(code);
        }
      });
      $('profile-save').addEventListener('click', Profile.save);

      bus.on('media', (uid) => {
        if (uid === S.uid) { KG.Drawer.render(); KG.List.render(); KG.Header.render(); }
        if (!$('card-modal').classList.contains('hidden')) {
          const open = $('card-login').textContent;
          if (open === KG.login(uid)) Profile.openCard(uid);
        }
      });
    },

    onClose() {
      draft = null;
      if (coverVideoUrl) { try { URL.revokeObjectURL(coverVideoUrl); } catch (e) {} coverVideoUrl = ''; }
    }
  };

  KG.Profile = Profile;
})(window.KG);
