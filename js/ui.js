/* =========================================================================
   Kitogram 4.0 — общий интерфейс
   Список чатов, шапка, аватары с рамками, обложки, тосты, меню.
   ========================================================================= */
(function (KG) {
  'use strict';

  const { $, $$, enc, now, S, escapeHTML, bus } = KG;

  /* ============================ аватары ============================ */
  const Avatar = {
    html(uidOrChat, opts) {
      opts = opts || {};
      const isChat = opts.chat;
      const uid = uidOrChat;
      const frame = opts.frame || (isChat ? 'none' : KG.People.frame(uid));
      const size = opts.size || 'md';
      const name = isChat ? KG.Dialogs.title(uid) : KG.People.name(uid);
      const src = isChat ? KG.Dialogs.avatar(uid) : KG.People.avatar(uid);
      const badge = opts.badge != null ? opts.badge : (isChat && uid.startsWith('group_') ? '' : KG.People.badge(uid));
      const online = opts.online != null ? opts.online : (!isChat ? KG.People.isOnline(uid) : false);
      return '<span class="av av-' + size + ' frame-' + escapeHTML(frame) + '">' +
        '<img class="av-img" alt="" src="' + escapeHTML(src) + '">' +
        (online ? '<i class="av-online"></i>' : '') +
        (badge ? '<i class="av-badge">' + escapeHTML(badge) + '</i>' : '') +
        '</span>';
    },
    decorate(el, uid, opts) {
      opts = opts || {};
      el.innerHTML = Avatar.html(uid, opts);
      return el;
    },
    nameStyle(uid) {
      const grad = KG.People.gradient(uid);
      if (grad) return 'background:' + grad + ';-webkit-background-clip:text;background-clip:text;color:transparent;';
      return 'color:' + KG.People.color(uid);
    },
    nameHTML(uid, text) {
      const st = Avatar.nameStyle(uid);
      return '<span class="grad-name" style="' + st + '">' + escapeHTML(text == null ? KG.People.name(uid) : text) + '</span>';
    }
  };

  /* ============================ обложки ============================ */
  const Cover = {
    style(uid) {
      const c = KG.People.cover(uid);
      if (c.src && (c.type === 'image' || c.type === 'gif')) {
        return 'background-image:linear-gradient(rgba(0,0,0,' + (Number(c.dim) || 0) / 100 + '),rgba(0,0,0,' + (Number(c.dim) || 0) / 100 + ')),url("' + String(c.src).replace(/"/g, '\\"') + '");' +
          (c.blur ? 'filter:blur(6px);transform:scale(1.08);' : '');
      }
      if (c.type === 'gradient' || !c.src) {
        return 'background:' + (KG.gradients[c.preset] || KG.gradients.aurora) + ';';
      }
      return 'background:' + (KG.gradients[c.preset] || KG.gradients.aurora) + ';';
    },
    /* заполнить контейнер: видео, gif или картинка */
    render(host, uid, opts) {
      opts = opts || {};
      if (!host) return;
      const c = KG.People.cover(uid);
      host.innerHTML = '';
      host.style.backgroundImage = '';
      host.style.background = '';
      host.className = (opts.className || 'cover-media');
      if (c.type === 'video' && c.src) {
        host.style.background = 'linear-gradient(rgba(0,0,0,' + (Number(c.dim) || 0) / 100 + '),rgba(0,0,0,' + (Number(c.dim) || 0) / 100 + '))';
        const v = document.createElement('video');
        v.src = String(c.src);
        v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.preload = 'metadata';
        v.className = 'cover-video';
        if (c.blur) v.style.filter = 'blur(6px)';
        if (c.poster) v.poster = c.poster;
        host.appendChild(v);
        const play = () => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
        play();
        host._video = v;
        host.addEventListener('mouseenter', play, { once: false });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) play(); });
      } else if (c.type === 'gif' && c.src) {
        host.style.background = 'linear-gradient(rgba(0,0,0,' + (Number(c.dim) || 0) / 100 + '),rgba(0,0,0,' + (Number(c.dim) || 0) / 100 + ')),url("' + String(c.src).replace(/"/g, '\\"') + '") center/cover';
        if (c.blur) host.style.filter = 'blur(5px)';
      } else {
        host.style.cssText += ';' + Cover.style(uid);
      }
    }
  };

  /* ============================ список чатов ============================ */
  const List = {
    preview(d, chatId) {
      const m = d.last;
      if (!m) {
        if (d.kind === 'global') return 'Общий чат — напишите первым';
        if (d.kind === 'group') return 'Группа создана. Напишите первым!';
        return 'Нет сообщений';
      }
      const mine = KG.Msgs.isMine(m);
      let text = '';
      if (m.type === 'image') text = '📷 Фото';
      else if (m.type === 'voice') text = '🎤 Голосовое';
      else if (m.type === 'video') text = '📹 Кружок';
      else if (m.type === 'gif') text = '🎞 GIF';
      else if (m.type === 'system') text = m.text || '';
      else text = (m.text || '').replace(/\s+/g, ' ').trim();
      if (m.by === 'system') return text;
      const prefix = mine ? 'Вы: ' : (d.kind === 'personal' ? '' : KG.People.name(m.by) + ': ');
      return prefix + text;
    },
    render() {
      const box = $('chat-list');
      if (!box) return;
      const q = ($('chat-search').value || '').trim().toLowerCase();
      let items = KG.Dialogs.sorted();
      if (q) {
        items = items.filter((d) => (d.title || '').toLowerCase().includes(q) || List.preview(d).toLowerCase().includes(q));
      }
      box.innerHTML = '';
      if (!items.length) {
        box.innerHTML = '<div class="empty-hint">Пока нет чатов.<br>Нажмите <b>＋</b> или введите логин в поиске,<br>чтобы найти человека и написать ему.</div>';
        return;
      }
      const frag = document.createDocumentFragment();
      items.forEach((d) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chat-item' + (S.activeChat === d.chatId ? ' active' : '') + (d.unread ? ' unread' : '');
        btn.dataset.chat = d.chatId;
        const badge = d.muted ? '' : (d.unread > 0 ? (d.unread > 99 ? '99+' : String(d.unread)) : '');
        const titleStyle = d.kind === 'personal' ? Avatar.nameStyle(d.peer) : '';
        btn.innerHTML =
          '<span class="chat-item-avatar">' + Avatar.html(d.chatId, { chat: true, online: d.online, size: 'md' }) + (d.pinned ? '<i class="pin-dot"></i>' : '') + '</span>' +
          '<span class="chat-item-body">' +
            '<span class="chat-item-top"><span class="chat-item-name" style="' + titleStyle + '">' + escapeHTML(d.title) + '</span>' +
            '<span class="chat-item-time">' + escapeHTML(KG.formatListTime(d.ts)) + '</span></span>' +
            '<span class="chat-item-bottom"><span class="chat-item-preview">' + escapeHTML(List.preview(d, d.chatId)) + '</span>' +
            (badge ? '<span class="unread-badge">' + badge + '</span>' : '') +
            '</span></span>';
        btn.addEventListener('click', () => KG.ChatUI.open(d.chatId));
        btn.addEventListener('contextmenu', (e) => { e.preventDefault(); List.menu(e.clientX, e.clientY, d); });
        let pressTimer = null;
        btn.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse') return;
          pressTimer = setTimeout(() => List.menu(e.clientX, e.clientY, d), 460);
        });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => btn.addEventListener(t, () => clearTimeout(pressTimer)));
        frag.appendChild(btn);
      });
      box.appendChild(frag);
      const total = items.reduce((n, d) => n + (d.muted ? 0 : d.unread), 0);
      document.title = (total ? '(' + total + ') ' : '') + 'Kitogram';
    },

    menu(x, y, d) {
      const items = [];
      items.push({ label: d.pinned ? 'Открепить' : 'Закрепить', action: () => { S.pinned[d.chatId] = !d.pinned; KG.persistLocal(); List.render(); } });
      items.push({ label: d.muted ? 'Включить звук' : 'Без звука', action: () => { S.muted[d.chatId] = !d.muted; KG.persistLocal(); List.render(); } });
      if (d.kind === 'personal') items.push({ label: 'Профиль', action: () => KG.Profile.openCard(d.peer) });
      items.push({ label: 'Скрыть чат', action: () => { S.hidden[d.chatId] = true; KG.persistLocal(); if (S.activeChat === d.chatId) KG.ChatUI.close(); List.render(); } });
      if (d.kind === 'personal' || d.kind === 'group') items.push({ label: 'Удалить переписку', danger: true, action: async () => {
        if (!confirm('Удалить переписку «' + d.title + '» у себя?')) return;
        try {
          if (d.kind === 'personal') await KG.Chat.deleteDialog(d.chatId);
          else { await KG.Groups.leave(d.chatId); }
          if (S.activeChat === d.chatId) KG.ChatUI.close();
          List.render();
        } catch (e) { KG.toast('Не удалось удалить', true); }
      } });
      KG.Popover.show(x, y, items);
    }
  };

  /* ============================ поповер-меню ============================ */
  const Popover = {
    show(x, y, items, opts) {
      opts = opts || {};
      const menu = $(opts.el || 'ctx-menu');
      if (!menu) return;
      menu.innerHTML = '';
      menu.classList.remove('hidden');
      items.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'popover-item' + (it.danger ? ' danger' : '');
        if (it.icon) b.innerHTML = '<svg class="ic"><use href="#' + it.icon + '"/></svg>';
        b.appendChild(document.createTextNode(it.label));
        b.addEventListener('click', () => { menu.classList.add('hidden'); it.action(); });
        menu.appendChild(b);
      });
      const rect = menu.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
      menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
    }
  };

  /* ============================ шапка ============================ */
  const Header = {
    render() {
      const peer = $('chat-peer');
      const area = $('composer-area');
      if (!S.activeChat) {
        $('app').classList.remove('chat-open');
        peer.classList.add('hidden');
        $('chat-placeholder').classList.remove('hidden');
        $('chat-menu').classList.add('hidden');
        area.classList.add('hidden');
        $('chat-empty').classList.remove('hidden');
        $('typing-bar').classList.remove('show');
        return;
      }
      const chatId = S.activeChat;
      peer.classList.remove('hidden');
      $('chat-placeholder').classList.add('hidden');
      $('chat-menu').classList.remove('hidden');
      area.classList.remove('hidden');
      $('chat-empty').classList.add('hidden');
      const av = $('chat-avatar');
      const wrap = av && av.parentNode;
      if (wrap) wrap.innerHTML = Avatar.html(chatId, { chat: true, online: chatId.indexOf('group_') === 0 ? false : KG.People.isOnline(chatId), size: 'md' });
      const titleEl = $('chat-title');
      titleEl.innerHTML = chatId.indexOf('group_') === 0 || chatId === KG.GLOBAL_KEY
        ? escapeHTML(KG.Dialogs.title(chatId))
        : Avatar.nameHTML(chatId);
      const sub = $('chat-sub');
      const typers = Header.typers(chatId);
      if (typers.length) {
        sub.textContent = typers.length === 1 ? typers[0] + ' печатает…' : 'несколько человек печатают…';
        sub.className = 'typing';
      } else if (chatId === KG.GLOBAL_KEY) {
        sub.textContent = 'общий чат Kitogram'; sub.className = '';
      } else if (chatId.indexOf('group_') === 0) {
        const d = KG.Groups.summary(chatId);
        sub.textContent = d.subtitle; sub.className = '';
      } else {
        const on = KG.People.isOnline(chatId);
        const st = KG.People.statusText(chatId);
        sub.textContent = on ? 'в сети' : (st || KG.People.lastSeenText(chatId));
        sub.className = on ? 'online' : '';
      }
    },
    typers(chatId) {
      if (!chatId || chatId === KG.GLOBAL_KEY) return [];
      const t = (S.nodes.typing && S.nodes.typing[chatId]) || {};
      const out = [];
      Object.keys(t).forEach((uid) => {
        if (uid === S.uid) return;
        const v = t[uid];
        const ts = typeof v === 'object' ? Number(v.ts || 0) : 0;
        if (ts && now() - ts < 7000) out.push(KG.People.name(uid));
      });
      return out;
    }
  };

  /* ============================ меню-ящик ============================ */
  const Drawer = {
    render() {
      const me = S.me || {};
      $('my-name').innerHTML = me.uid ? Avatar.nameHTML(S.uid, me.displayName || me.name || '') : escapeHTML(me.displayName || '');
      $('my-username').textContent = KG.login(S.uid);
      const badge = $('my-badge');
      const b = KG.People.badge(S.uid);
      badge.textContent = b || '';
      const wrap = $('my-avatar-wrap');
      wrap.className = 'drawer-avatar';
      wrap.innerHTML = Avatar.html(S.uid, { size: 'lg', online: false });
      $('app-version').textContent = KG.VERSION;
    },
    open() { Drawer.render(); $('drawer').classList.remove('hidden'); },
    close() { $('drawer').classList.add('hidden'); }
  };

  /* ============================ поиск ============================ */
  const Search = {
    render() {
      const box = $('search-results');
      const raw = ($('chat-search').value || '').trim();
      const q = raw.toLowerCase();
      if (!raw) { box.classList.add('hidden'); box.innerHTML = ''; List.render(); return; }
      List.render();
      box.classList.remove('hidden');

      // ---- люди (основное: чтобы можно было написать) ----
      const people = KG.SearchPeople.find(raw).filter((uid) => uid !== S.uid).slice(0, 12);

      // ---- сообщения ----
      const needle = KG.SearchPeople.needle(raw);
      const hits = [];
      if (needle) {
        KG.Dialogs.all().forEach((d) => {
          KG.Msgs.list(d.chatId).forEach((m) => {
            if (!m.text || m.type === 'voice' || m.type === 'video') return;
            const idx = String(m.text).toLowerCase().indexOf(needle);
            if (idx !== -1) hits.push({ chatId: d.chatId, m, idx, title: d.title });
          });
        });
      }
      hits.sort((a, b) => Number(b.m.ts || 0) - Number(a.m.ts || 0));

      box.innerHTML = '';

      if (people.length) {
        const t = document.createElement('div');
        t.className = 'search-title';
        t.textContent = 'Люди (' + people.length + ')';
        box.appendChild(t);
        people.forEach((uid) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'search-hit person';
          b.innerHTML = KG.Avatar.html(uid, { size: 'sm' }) +
            '<span class="search-hit-body"><span class="search-hit-name">' + escapeHTML(KG.People.name(uid)) + '</span>' +
            '<span class="search-hit-text">' + escapeHTML(KG.login(uid)) + ' · написать</span></span>' +
            '<span class="chev"><svg class="ic"><use href="#i-chevron"/></svg></span>';
          b.addEventListener('click', () => {
            $('chat-search').value = '';
            Search.render();
            KG.ChatUI.open(uid);
          });
          box.appendChild(b);
        });
      }

      if (hits.length) {
        const t = document.createElement('div');
        t.className = 'search-title';
        t.textContent = 'Сообщения (' + hits.length + ')';
        box.appendChild(t);
        hits.slice(0, 30).forEach((hit) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'search-hit';
          const txt = String(hit.m.text);
          const start = Math.max(0, hit.idx - 24);
          b.innerHTML = '<div class="search-hit-name">' + escapeHTML(hit.title) + ' · ' + escapeHTML(KG.formatListTime(hit.m.ts)) + '</div>' +
            '<div class="search-hit-text">' + (start ? '…' : '') + escapeHTML(txt.slice(start, hit.idx)) +
            '<mark>' + escapeHTML(txt.slice(hit.idx, hit.idx + needle.length)) + '</mark>' +
            escapeHTML(txt.slice(hit.idx + needle.length, hit.idx + needle.length + 60)) + '</div>';
          b.addEventListener('click', () => {
            $('chat-search').value = '';
            Search.render();
            KG.ChatUI.open(hit.chatId, { focus: hit.m.id });
          });
          box.appendChild(b);
        });
      }

      if (!people.length && !hits.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-hint';
        empty.innerHTML = (S.usersLoaded
          ? 'Никого не нашли по «' + escapeHTML(raw) + '».<br><span class="hint-sub">Логин пишется латиницей, например @kito</span>'
          : 'Загружаем людей…') +
          '<br><button type="button" class="mini-btn" id="search-newchat">Открыть «Новый чат»</button>';
        box.appendChild(empty);
        const btn = box.querySelector('#search-newchat');
        if (btn) btn.addEventListener('click', () => { $('chat-search').value = ''; Search.render(); KG.NewChat.open(); });
      }
    },

    /* подсказка «найти человека» в пустом списке чатов */
    hint() {
      return '<div class="empty-hint">Пока нет чатов.<br>Нажмите <b>＋</b> или введите логин в поиске,<br>чтобы найти человека и написать ему.</div>';
    }
  };

  /* ============================ чат: открытие/закрытие ============================ */
  const ChatUI = {
    open(chatId, opts) {
      opts = opts || {};
      if (!KG.Dialogs.canOpen(chatId)) { KG.toast('Нет доступа к этому чату', true); return; }
      if (S.activeChat && S.activeChat !== chatId) ChatUI.close(true);
      S.activeChat = chatId;
      delete S.hidden[chatId];
      KG.persistLocal();
      if (chatId.indexOf('group_') === 0) KG.Groups.loadMessages(chatId);
      if (KG.mq('(max-width: 760px)').matches) $('app').classList.add('chat-open');
      $('chat-search').value = '';
      $('search-results').classList.add('hidden');
      Drawer.close();
      Header.render();
      KG.Messages.render();
      List.render();
      ChatUI.markRead();
      if (opts.focus) setTimeout(() => KG.Messages.scrollTo(opts.focus), 120);
      const input = $('message-input');
      input.value = S.drafts[chatId] || '';
      input.style.height = 'auto';
      if (input.value) input.style.height = Math.min(160, input.scrollHeight) + 'px';
      KG.Messages.updateSendButton();
      if (!KG.isTouch() && !opts.noFocus) setTimeout(() => input.focus(), 40);
      bus.emit('chat', chatId);
    },
    close(keepActive) {
      if (!S.activeChat) return;
      if (S.drafts) S.drafts[S.activeChat] = $('message-input').value;
      KG.storage.jsonSet(KG.KEY.drafts, S.drafts || {});
      if (KG.Chat.clearTyping) KG.Chat.clearTyping(S.activeChat);
      S.activeChat = null;
      $('app').classList.remove('chat-open');
      $('message-input').value = '';
      Header.render();
      List.render();
      if (keepActive) S.activeChat = null;
    },
    markRead() {
      const chatId = S.activeChat;
      if (!chatId) return;
      if (chatId.indexOf('group_') === 0) KG.Groups.markRead(chatId);
      else if (chatId !== KG.GLOBAL_KEY) KG.Chat.markRead(chatId);
      else {
        S.nodes.acc.read[KG.GLOBAL_KEY] = now();
        KG.api.put('accounts/' + enc(S.uid) + '/read/' + KG.GLOBAL_KEY, now()).catch(() => {});
      }
      List.render();
    },
    refresh() {
      Header.render();
      List.render();
      if (S.activeChat) KG.Messages.render();
    }
  };

  /* ============================ инициализация обработчиков ============================ */
  const bind = () => {
    // меню
    $('open-menu').addEventListener('click', Drawer.open);
    $('drawer').addEventListener('click', (e) => { if (e.target.matches('[data-close]')) Drawer.close(); });
    $('drawer-profile-btn').addEventListener('click', () => { Drawer.close(); KG.Profile.openEditor(); });
    $('menu-profile').addEventListener('click', () => { Drawer.close(); KG.Profile.openEditor(); });
    $('menu-settings').addEventListener('click', () => { Drawer.close(); KG.Settings.open(); });
    $('menu-new-chat').addEventListener('click', () => { Drawer.close(); KG.NewChat.open(); });
    $('menu-new-group').addEventListener('click', () => { Drawer.close(); KG.GroupsUI.openCreate(); });
    $('menu-global').addEventListener('click', () => { Drawer.close(); delete S.hidden[KG.GLOBAL_KEY]; KG.persistLocal(); ChatUI.open(KG.GLOBAL_KEY); });
    $('menu-logout').addEventListener('click', KG.Auth.logout);

    // модалки
    document.addEventListener('click', (e) => {
      const closer = e.target.closest('[data-close]');
      if (closer) {
        const modal = closer.closest('.modal');
        if (modal) KG.closeModal(modal);
        if (closer.closest('.drawer')) Drawer.close();
      }
      if (e.target.classList && e.target.classList.contains('modal')) KG.closeModal(e.target);
      if (!e.target.closest('#ctx-menu') && !e.target.closest('#attach-menu')) KG.closePopovers();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { KG.closeAllModals(); Drawer.close(); KG.closePopovers(); }
    });

    // шапка
    $('chat-peer').addEventListener('click', () => {
      const c = S.activeChat;
      if (!c) return;
      if (c.indexOf('group_') === 0) KG.GroupsUI.openInfo(c);
      else if (c === KG.GLOBAL_KEY) KG.GroupsUI.openInfo(c);
      else KG.Profile.openCard(c);
    });
    $('chat-menu').addEventListener('click', () => {
      const c = S.activeChat;
      if (!c) return;
      if (c.indexOf('group_') === 0 || c === KG.GLOBAL_KEY) KG.GroupsUI.openInfo(c);
      else {
        const r = $('chat-menu').getBoundingClientRect();
        Popover.show(r.left - 160, r.bottom + 6, [
          { icon: 'i-user', label: 'Профиль', action: () => KG.Profile.openCard(c) },
          { icon: 'i-search', label: 'Поиск в чате', action: () => { $('chat-search').focus(); } },
          { icon: 'i-bell-off', label: S.muted[c] ? 'Включить звук' : 'Без звука', action: () => { S.muted[c] = !S.muted[c]; KG.persistLocal(); List.render(); } },
          { icon: 'i-trash', label: 'Очистить историю', danger: true, action: async () => {
            if (!confirm('Удалить всю переписку у себя?')) return;
            await KG.Chat.deleteDialog(c);
            ChatUI.close();
          } }
        ]);
      }
    });
    $('mobile-back').addEventListener('click', () => ChatUI.close());

    // поиск
    $('chat-search').addEventListener('input', KG.debounce(() => Search.render(), 140));
    $('chat-search').addEventListener('focus', () => Search.render());

    // перерисовки по данным
    bus.on('chats', KG.debounce(() => List.render(), 60));
    bus.on('people', KG.debounce(() => {
      List.render(); Header.render();
      if (($('chat-search').value || '').trim()) Search.render();
    }, 120));
    bus.on('people-ready', () => {
      if (($('chat-search').value || '').trim()) Search.render();
      if (!$('newchat-modal').classList.contains('hidden')) KG.NewChat.render($('newchat-search').value);
    });
    bus.on('messages', KG.debounce(() => { List.render(); }, 80));
    bus.on('media', KG.debounce((uid) => {
      List.render();
      Header.render();
      if (S.activeChat) KG.Messages.render();
      if (KG.Profile && KG.Profile.onMedia) KG.Profile.onMedia(uid);
    }, 100));
    bus.on('incoming', (e) => {
      const d = KG.Dialogs.find(e.peer);
      if (d && !d.muted && (document.hidden || S.activeChat !== e.peer)) KG.toast('Новое сообщение от ' + (d.title || ''));
    });
    bus.on('net', () => UI.netStatus());
    bus.on('settings', () => UI.syncSettingsControls());
  };

  const UI = {
    netStatus() {
      const el = $('net-status');
      if (!el) return;
      if (!navigator.onLine) { el.textContent = 'нет сети'; el.className = 'net-status offline'; return; }
      if (S.channelReady) { el.textContent = 'в сети · обновления в реальном времени'; el.className = 'net-status online'; }
      else { el.textContent = 'подключение…'; el.className = 'net-status'; }
    },
    syncSettingsControls() {
      const s = S.settings || {};
      const set = (id, v) => { const el = $(id); if (el && v !== undefined) el.value = v; };
      set('set-theme', s.theme); set('set-bubble', s.bubble); set('set-font', s.font);
      set('set-wall-dim', s.wallDim);
      const sound = $('set-sound'), typing = $('set-typing-hidden'), effects = $('set-effects');
      if (sound) sound.checked = s.sound !== false;
      if (typing) typing.checked = !!s.hideTyping;
      if (effects) effects.checked = s.effects !== false;
    },
    bind
  };

  KG.Avatar = Avatar;
  KG.Cover = Cover;
  KG.List = List;
  KG.Popover = Popover;
  KG.Header = Header;
  KG.Drawer = Drawer;
  KG.Search = Search;
  KG.ChatUI = ChatUI;
  KG.UI = UI;
})(window.KG);
