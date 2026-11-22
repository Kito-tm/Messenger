/* =========================================================================
   Kitogram 4.0 — группы и общий чат
   ========================================================================= */
(function (KG) {
  'use strict';

  const { $, enc, now, S, escapeHTML, api } = KG;

  let selected = new Set();
  let newAvatar = null;
  let avatarTarget = null;

  const GroupsUI = {
    openCreate() {
      KG.closeAllModals();
      selected = new Set();
      newAvatar = null;
      $('new-group-name').value = '';
      const img = $('new-group-avatar');
      img.src = KG.avatarFallback('G', 'new-group');
      GroupsUI.renderMembers();
      KG.openModal('group-modal');
      setTimeout(() => $('new-group-name').focus(), 60);
    },

    renderMembers() {
      const list = $('new-group-members');
      const uids = Object.keys(S.nodes.people || {})
        .filter((uid) => uid !== S.uid && uid !== 'system')
        .sort((a, b) => (KG.People.isOnline(b) ? 1 : 0) - (KG.People.isOnline(a) ? 1 : 0) || KG.People.name(a).localeCompare(KG.People.name(b), 'ru'));
      list.innerHTML = '';
      if (!uids.length) { list.innerHTML = '<div class="empty-hint">Пока нет других пользователей</div>'; return; }
      uids.forEach((uid) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'user-row' + (selected.has(uid) ? ' selected' : '');
        row.innerHTML = KG.Avatar.html(uid, { size: 'sm' }) +
          '<span class="user-row-body"><span class="user-row-name">' + escapeHTML(KG.People.name(uid)) + '</span>' +
          '<span class="user-row-login">' + escapeHTML(KG.login(uid)) + '</span></span>' +
          '<span class="check"><svg class="ic"><use href="#i-check"/></svg></span>';
        row.addEventListener('click', () => {
          if (selected.has(uid)) selected.delete(uid); else selected.add(uid);
          row.classList.toggle('selected');
        });
        list.appendChild(row);
      });
    },

    async create() {
      const name = $('new-group-name').value.trim();
      if (!name) { KG.toast('Введите название группы', true); return; }
      const btn = $('create-group-btn');
      btn.disabled = true;
      try {
        const gid = await KG.Groups.create(name, Array.from(selected), newAvatar || '');
        KG.closeAllModals();
        KG.ChatUI.open(gid);
        KG.toast('Группа создана');
      } catch (e) {
        KG.toast('Не удалось создать группу', true);
      } finally { btn.disabled = false; }
    },

    openInfo(gid) {
      const body = $('info-body');
      const isGroup = gid !== KG.GLOBAL_KEY;
      $('info-title').textContent = isGroup ? 'О группе' : 'Общий чат';
      body.innerHTML = '';
      if (!isGroup) {
        body.innerHTML = '<div class="info-hero"><span class="av av-xl">' + KG.Avatar.html(KG.GLOBAL_KEY, { chat: true, size: 'xl' }) + '</span>' +
          '<div class="info-name">Общий чат</div><div class="info-sub">Открытый чат для всех пользователей Kitogram</div></div>';
        const hide = document.createElement('button');
        hide.type = 'button';
        hide.className = 'btn btn-danger btn-block';
        hide.textContent = 'Скрыть чат у себя';
        hide.addEventListener('click', () => { S.hidden[KG.GLOBAL_KEY] = true; KG.persistLocal(); KG.closeAllModals(); KG.ChatUI.close(); KG.List.render(); });
        body.appendChild(hide);
        KG.openModal('info-modal');
        return;
      }
      const g = KG.Groups.get(gid) || {};
      const creator = KG.Groups.isCreator(gid);
      const members = KG.Groups.members(gid);

      const hero = document.createElement('div');
      hero.className = 'info-hero';
      hero.innerHTML = '<span class="av av-xl">' + KG.Avatar.html(gid, { chat: true, size: 'xl' }) + '</span>' +
        '<div class="info-name">' + escapeHTML(g.name || 'Группа') + '</div>' +
        '<div class="info-sub">' + members.length + ' ' + KG.plural(members.length, 'участник', 'участника', 'участников') + '</div>';
      body.appendChild(hero);
      if (creator) {
        const avBtn = document.createElement('button');
        avBtn.type = 'button';
        avBtn.className = 'btn btn-secondary btn-block';
        avBtn.textContent = 'Сменить фото группы';
        avBtn.addEventListener('click', () => { avatarTarget = gid; $('group-avatar-file').click(); });
        body.appendChild(avBtn);

        const block = document.createElement('div');
        block.className = 'info-block';
        block.innerHTML = '<div class="info-line"><span>Название</span></div>';
        const inp = document.createElement('input');
        inp.type = 'text'; inp.className = 'inline-input'; inp.value = g.name || ''; inp.maxLength = 50;
        const save = document.createElement('button');
        save.type = 'button'; save.className = 'mini-btn'; save.textContent = 'Сохранить';
        save.addEventListener('click', async () => {
          const nv = inp.value.trim();
          if (!nv) return;
          try {
            await KG.Groups.update(gid, { name: nv });
            await api.put('messages/' + enc(gid) + '/' + enc(KG.newId()), { by: 'system', ts: now(), type: 'system', text: 'Название группы изменено на «' + nv + '»' });
            KG.Header.render(); KG.List.render(); GroupsUI.openInfo(gid);
          } catch (e) { KG.toast('Не удалось переименовать', true); }
        });
        const row = document.createElement('div');
        row.className = 'inline-row';
        row.append(inp, save);
        block.appendChild(row);
        body.appendChild(block);
      }

      const title = document.createElement('div');
      title.className = 'field-title';
      title.textContent = 'Участники · ' + members.length;
      body.appendChild(title);
      const list = document.createElement('div');
      list.className = 'info-block';
      members.forEach((uid) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'user-row';
        row.innerHTML = KG.Avatar.html(uid, { size: 'sm' }) +
          '<span class="user-row-body"><span class="user-row-name">' + escapeHTML(KG.People.name(uid)) + (uid === S.uid ? ' <i class="me-mark">(вы)</i>' : '') + '</span>' +
          '<span class="user-row-login">' + escapeHTML(KG.login(uid)) + (KG.People.isOnline(uid) ? ' · в сети' : '') + '</span></span>' +
          (g.creator === uid ? '<span class="badge-creator">создатель</span>' : '');
        row.addEventListener('click', () => { if (uid !== S.uid) KG.Profile.openCard(uid); });
        if (creator && uid !== S.uid) {
          const kick = document.createElement('button');
          kick.type = 'button'; kick.className = 'mini-btn danger'; kick.textContent = '×';
          kick.title = 'Исключить';
          kick.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Исключить ' + KG.People.name(uid) + '?')) return;
            try { await KG.Groups.kick(gid, uid); GroupsUI.openInfo(gid); } catch (err) { KG.toast('Не удалось', true); }
          });
          row.appendChild(kick);
        }
        list.appendChild(row);
      });
      body.appendChild(list);

      if (creator) {
        const addTitle = document.createElement('div');
        addTitle.className = 'field-title'; addTitle.textContent = 'Добавить участников';
        body.appendChild(addTitle);
        const candidates = Object.keys(S.nodes.people || {}).filter((u) => !(g.members || {})[u] && u !== 'system');
        const picker = document.createElement('div');
        picker.className = 'member-list';
        if (!candidates.length) picker.innerHTML = '<div class="empty-hint">Все пользователи уже в группе</div>';
        candidates.forEach((uid) => {
          const row = document.createElement('button');
          row.type = 'button'; row.className = 'user-row';
          row.innerHTML = KG.Avatar.html(uid, { size: 'sm' }) +
            '<span class="user-row-body"><span class="user-row-name">' + escapeHTML(KG.People.name(uid)) + '</span></span>' +
            '<span class="chev"><svg class="ic"><use href="#i-plus"/></svg></span>';
          row.addEventListener('click', async () => {
            try { await KG.Groups.addMembers(gid, [uid]); GroupsUI.openInfo(gid); } catch (e) { KG.toast('Не удалось добавить', true); }
          });
          picker.appendChild(row);
        });
        body.appendChild(picker);
      }

      const actions = document.createElement('div');
      actions.className = 'info-actions';
      const leave = document.createElement('button');
      leave.type = 'button';
      leave.className = 'btn btn-danger btn-block';
      leave.textContent = creator ? 'Удалить группу' : 'Выйти из группы';
      leave.addEventListener('click', async () => {
        if (!confirm(creator ? 'Удалить группу для всех?' : 'Выйти из группы?')) return;
        try {
          if (creator) await KG.Groups.destroy(gid);
          else await KG.Groups.leave(gid);
          KG.closeAllModals(); KG.ChatUI.close(); KG.List.render();
          KG.toast('Готово');
        } catch (e) { KG.toast('Ошибка операции', true); }
      });
      actions.appendChild(leave);
      body.appendChild(actions);
      KG.openModal('info-modal');
    },

    bind() {
      $('new-group-avatar-btn').addEventListener('click', () => $('new-group-avatar-file').click());
      $('new-group-avatar-file').addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        try {
          newAvatar = await KG.media.imageToDataURL(f, 240, 0.8);
          $('new-group-avatar').src = newAvatar;
        } catch (err) { KG.toast('Не удалось обработать фото', true); }
      });
      $('create-group-btn').addEventListener('click', GroupsUI.create);
      $('newchat-create-group').addEventListener('click', GroupsUI.openCreate);
      $('group-avatar-file').addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f || !avatarTarget) return;
        try {
          const data = await KG.media.imageToDataURL(f, 240, 0.8);
          await KG.Groups.update(avatarTarget, { avatar: data });
          KG.Header.render();
          if (!$('info-modal').classList.contains('hidden')) GroupsUI.openInfo(avatarTarget);
          KG.toast('Фото группы обновлено');
        } catch (err) { KG.toast('Не удалось обновить фото', true); }
      });
    }
  };

  KG.GroupsUI = GroupsUI;
})(window.KG);
