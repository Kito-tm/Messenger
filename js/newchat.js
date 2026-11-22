/* =========================================================================
   Kitogram 4.0 — поиск людей и начало нового чата
   ========================================================================= */
(function (KG) {
  'use strict';

  const { $, S, escapeHTML } = KG;

  const NewChat = {
    open() {
      $('newchat-search').value = '';
      NewChat.render('');
      KG.openModal('newchat-modal');
      setTimeout(() => $('newchat-search').focus(), 60);
    },

    render(query) {
      const list = $('newchat-list');
      const qRaw = String(query || '').trim();
      const ready = S.usersLoaded;
      if (!ready && !Object.keys(S.nodes.people || {}).length) {
        list.innerHTML = '<div class="empty-hint">Загружаем пользователей…<br><span class="hint-sub">если долго — проверьте интернет</span></div>';
        // страховка: подтянуть список напрямую
        KG.PeopleLoader && KG.PeopleLoader.fetchAll(true);
        return;
      }
      if (!ready && KG.PeopleLoader) KG.PeopleLoader.fetchAll(true);

      const sp = KG.SearchPeople;
      const uids = (sp && typeof sp.find === 'function' ? sp.find(qRaw) : Object.keys(S.nodes.people || {}))
        .filter((uid) => uid && uid !== S.uid);
      list.innerHTML = '';
      if (!uids.length) {
        const msg = qRaw
          ? 'По запросу «' + escapeHTML(qRaw) + '» никого не нашли.<br><span class="hint-sub">Проверьте написание логина — он латиницей: например @kito</span>'
          : 'Пока никто не зарегистрировался.<br><span class="hint-sub">Позовите друзей в Kitogram!</span>';
        list.innerHTML = '<div class="empty-hint">' + msg + '</div>';
        return;
      }
      uids.slice(0, 200).forEach((uid) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'user-row';
        row.innerHTML = KG.Avatar.html(uid, { size: 'md' }) +
          '<span class="user-row-body"><span class="user-row-name">' + escapeHTML(KG.People.name(uid)) + '</span>' +
          '<span class="user-row-login">' + escapeHTML(KG.login(uid)) + (KG.People.isOnline(uid) ? ' · в сети' : '') + '</span></span>' +
          '<span class="chev"><svg class="ic"><use href="#i-chevron"/></svg></span>';
        row.addEventListener('click', () => { KG.closeAllModals(); KG.ChatUI.open(uid); });
        const info = document.createElement('button');
        info.type = 'button';
        info.className = 'mini-btn';
        info.textContent = 'i';
        info.title = 'Профиль';
        info.addEventListener('click', (e) => { e.stopPropagation(); KG.Profile.openCard(uid); });
        row.appendChild(info);
        list.appendChild(row);
      });
    },

    bind() {
      $('new-chat').addEventListener('click', NewChat.open);
      KG.bus.on('people-ready', () => {
        if (!$('newchat-modal').classList.contains('hidden')) NewChat.render($('newchat-search').value);
      });
      $('newchat-search').addEventListener('input', (e) => NewChat.render(e.target.value));
      KG.bus.on('people', KG.debounce(() => {
        if (!$('newchat-modal').classList.contains('hidden')) NewChat.render($('newchat-search').value);
      }, 120));
    }
  };

  KG.NewChat = NewChat;
})(window.KG);
