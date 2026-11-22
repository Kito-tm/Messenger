/* =========================================================================
   Kitogram 4.0 — данные
   Люди, чаты, доставка сообщений, список диалогов, непрочитанные,
   «печатает…», реакции, закрепления, скрытие/мьют чатов.
   ========================================================================= */
(function (KG) {
  'use strict';

  const {
    $, enc, dec, now, newId, bus, S, api, storage, KEY, GLOBAL_KEY, escapeHTML
  } = KG;

  /* ============================ люди ============================ */
  const People = {
    get(uid) {
      if (!uid) return null;
      if (uid === S.uid) return S.me;
      if (S.nodes.people && S.nodes.people[uid]) return S.nodes.people[uid];
      if (S.nodes.acc && S.nodes.acc.chats && S.nodes.acc.chats[uid] && S.nodes.acc.chats[uid].peer) {
        return S.nodes.acc.chats[uid].peer;
      }
      return null;
    },
    name(uid) {
      if (uid === 'system') return 'Kitogram';
      const p = People.get(uid);
      if (p) return p.displayName || p.name || login(uid);
      return login(uid);
    },
    avatar(uid) {
      if (uid === S.uid) {
        const mine = (S.mediaSelf && S.mediaSelf.avatar) || (S.me && S.me.avatar) || '';
        return mine || KG.avatarFallback(People.name(uid), uid);
      }
      if (uid === 'system') return KG.avatarFallback('K', 'system');
      const cached = KG.media.cache.get(uid);
      if (cached && (cached.avatarThumb || cached.avatar)) return cached.avatarThumb || cached.avatar;
      const p = People.get(uid);
      if (p && (p.avatarThumb || p.avatar)) return p.avatarThumb || p.avatar;
      return KG.avatarFallback(People.name(uid), uid);
    },
    cover(uid) {
      const p = People.get(uid);
      const cached = uid === S.uid ? (S.mediaSelf || {}) : (KG.media.cache.get(uid) || {});
      const full = cached.cover || (p && p.coverSrc) || '';
      return {
        type: (p && p.coverType) || 'gradient',
        preset: (p && p.coverPreset) || 'aurora',
        src: full || '',
        blur: !!(p && p.coverBlur),
        dim: p && typeof p.coverDim === 'number' ? p.coverDim : 24,
        poster: cached.coverPoster || (p && p.coverPoster) || ''
      };
    },
    color(uid) {
      const p = People.get(uid);
      return (p && p.color) || KG.uidColor(uid);
    },
    gradient(uid) {
      const p = People.get(uid);
      if (p && p.gradOn) return 'linear-gradient(90deg,' + (p.gradA || '#2f9ede') + ',' + (p.gradB || '#a855f7') + ')';
      return '';
    },
    frame(uid) {
      const p = People.get(uid);
      return (p && p.frame) || 'none';
    },
    badge(uid) {
      const p = People.get(uid);
      return (p && p.badge) || '';
    },
    statusText(uid) {
      const p = People.get(uid);
      return (p && p.status) || '';
    },
    bio(uid) {
      const p = People.get(uid);
      return (p && p.bio) || '';
    },
    isOnline(uid) {
      if (!uid) return false;
      const st = S.nodes.status && S.nodes.status[uid];
      if (st && st.online === true) {
        const ts = Number(st.ts || 0);
        if (!ts || now() - ts < 4 * 60000) return true;
      }
      const p = People.get(uid);
      if (p && p.lastSeen && now() - Number(p.lastSeen) < 3 * 60000 && p.online) return true;
      return false;
    },
    lastSeen(uid) {
      const p = People.get(uid);
      const st = S.nodes.status && S.nodes.status[uid];
      const ts = Math.max(Number((st && st.ts) || 0), Number((p && p.lastSeen) || 0));
      return ts;
    },
    lastSeenText(uid) {
      if (People.isOnline(uid)) return 'в сети';
      const ts = People.lastSeen(uid);
      if (!ts) return 'был(а) недавно';
      const diff = now() - ts;
      if (diff < 60000) return 'был(а) только что';
      if (diff < 3600000) return 'был(а) ' + Math.max(1, Math.round(diff / 60000)) + ' ' + KG.plural(Math.round(diff / 60000), 'минуту', 'минуты', 'минут') + ' назад';
      if (KG.dayKey(ts) === KG.dayKey(now())) return 'был(а) сегодня в ' + KG.formatTime(ts);
      if (KG.dayKey(ts) === KG.dayKey(now() - 864e5)) return 'был(а) вчера в ' + KG.formatTime(ts);
      return 'был(а) ' + KG.formatDay(ts);
    },
    async load(uid) {
      if (!uid || uid === S.uid) return null;
      try {
        const p = await api.get('people/' + enc(uid));
        if (p) { S.nodes.people[uid] = p; bus.emit('people', uid); }
        KG.media.fetchUserMedia(uid);
        return p;
      } catch (e) { return null; }
    }
  };

  const login = (uid) => String(uid || '').replace(/^@+/, '') ? '@' + String(uid).replace(/^@+/, '') : '';

  /* ============================ личные чаты ============================ */
  const Chat = {
    id(peer) { return peer; },
    /* объединённое хранилище: собственные сообщения + входящие из inbox */
    messages(peer) {
      const mine = (S.nodes.acc.messages && S.nodes.acc.messages[peer]) || {};
      const inc = (S.nodes.inbox && S.nodes.inbox[peer]) || {};
      const out = {};
      for (const id in inc) {
        const m = inc[id];
        if (!m || typeof m !== 'object') continue;
        out[id] = Object.assign({ id }, m, { out: false });
      }
      for (const id in mine) {
        const m = mine[id];
        if (!m || typeof m !== 'object') continue;
        const base = out[id] || {};
        out[id] = Object.assign({ id }, base, m, { out: true });
        // реакции могли прийти в inbox
        if (base.reactions && !m.reactions) out[id].reactions = base.reactions;
      }
      return out;
    },
    meta(peer) {
      return (S.nodes.acc.chats && S.nodes.acc.chats[peer]) || {};
    },
    isPersonal(chatId) {
      return !!chatId && chatId !== GLOBAL_KEY && !chatId.startsWith('group_');
    },
    exists(peer) {
      return !!(S.nodes.acc.chats && S.nodes.acc.chats[peer]);
    },
    /* локальная модель диалога для рендера списка */
    summary(peer) {
      const msgs = Chat.messages(peer);
      let last = null, lastTs = 0;
      for (const id in msgs) {
        const m = msgs[id];
        if (!m || typeof m !== 'object') continue;
        const t = Number(m.ts || 0);
        if (t >= lastTs) { lastTs = t; last = Object.assign({ id }, m); }
      }
      const meta = Chat.meta(peer);
      const readTs = Number((S.nodes.acc.read && S.nodes.acc.read[peer]) || 0);
      const hiddenId = (S.hiddenMsgs[peer] || {});
      let unread = 0;
      if (!hiddenId.__all) {
        for (const id in msgs) {
          const m = msgs[id];
          if (!m || typeof m !== 'object') continue;
          if (m.by === S.uid) continue;
          if (Number(m.ts || 0) > readTs) unread++;
        }
      }
      return {
        chatId: peer,
        kind: 'personal',
        peer,
        title: People.name(peer),
        avatar: People.avatar(peer),
        last,
        ts: lastTs || Number(meta.createdAt || 0),
        unread,
        online: People.isOnline(peer),
        muted: !!S.muted[peer],
        pinned: !!S.pinned[peer],
        hidden: !!S.hidden[peer]
      };
    },
    hiddenLocalMsgs(peer) { return S.hiddenMsgs[peer] || {}; },

    /* отправка личного сообщения: себе в аккаунт + в inbox получателя */
    async send(peer, payload) {
      const uid = S.uid;
      if (!uid) throw new Error('no auth');
      if (!peer || peer === uid) throw new Error('bad peer');
      const ts = now();
      const id = newId();
      const base = { id, by: uid, ts, type: 'text', ...payload };
      Object.keys(base).forEach((k) => { if (base[k] === undefined || base[k] === null) delete base[k]; });
      const myMsg = Object.assign({}, base, { out: true });
      // оптимистично в локальную модель
      S.nodes.acc.messages[peer] = S.nodes.acc.messages[peer] || {};
      S.nodes.acc.messages[peer][id] = Object.assign({}, myMsg, { pending: true });
      S.nodes.acc.chats[peer] = Object.assign({ peerMeta: true }, S.nodes.acc.chats[peer], {
        peerUid: peer, createdAt: (S.nodes.acc.chats[peer] || {}).createdAt || ts, updatedAt: ts, lastId: id
      });
      S.nodes.acc.read[peer] = ts;
      bus.emit('messages', peer);
      bus.emit('chats');
      try {
        await Promise.all([
          api.put('accounts/' + enc(uid) + '/messages/' + enc(peer) + '/' + enc(id), myMsg),
          api.put('accounts/' + enc(uid) + '/chats/' + enc(peer), {
            peerUid: peer, createdAt: (S.nodes.acc.chats[peer] || {}).createdAt || ts, updatedAt: ts, lastId: id, peerMeta: false
          }),
          api.put('inbox/' + enc(peer) + '/' + enc(uid) + '/' + id, base)
        ]);
        const mine = S.nodes.acc.messages[peer][id];
        if (mine) { delete mine.pending; }
        if (mine && mine.failed) delete mine.failed;
        await Chat.ensurePeerMirror(peer);
        bus.emit('messages', peer);
        return id;
      } catch (e) {
        const mine = S.nodes.acc.messages[peer] && S.nodes.acc.messages[peer][id];
        if (mine) { mine.pending = false; mine.failed = true; }
        bus.emit('messages', peer);
        throw e;
      }
    },

    /* чтобы «новый чат» работал без переписки */
    async ensurePeerMirror(peer) {
      // ensure lightweight people record exists for search
      try {
        const existing = S.nodes.people && S.nodes.people[peer];
        if (!existing) {
          const p = await api.get('people/' + enc(peer));
          if (p) { S.nodes.people[peer] = p; bus.emit('people', peer); }
        }
      } catch (e) {}
    },

    async markRead(peer) {
      const ts = now();
      S.nodes.acc.read = S.nodes.acc.read || {};
      S.nodes.acc.read[peer] = ts;
      KG.storage.jsonSet(KEY.read, S.nodes.acc.read);
      try { await api.put('accounts/' + enc(S.uid) + '/read/' + enc(peer), ts); } catch (e) {}
      bus.emit('read', peer);
    },

    async setTyping(peer) {
      if (!S.uid || !peer) return;
      if (KG.isTouch() && document.hidden) return;
      try {
        await api.put('typing/' + enc(peer) + '/' + enc(S.uid), { ts: now(), name: People.name(S.uid) });
      } catch (e) {}
    },

    async clearTyping(peer) {
      if (!S.uid || !peer) return;
      try { await api.del('typing/' + enc(peer) + '/' + enc(S.uid)); } catch (e) {}
    },

    peers() {
      const out = new Set();
      const chats = (S.nodes.acc && S.nodes.acc.chats) || {};
      Object.keys(chats).forEach((p) => out.add(p));
      const msgs = (S.nodes.acc && S.nodes.acc.messages) || {};
      Object.keys(msgs).forEach((p) => out.add(p));
      Object.keys(S.nodes.inbox || {}).forEach((p) => out.add(p));
      out.delete(S.uid);
      return Array.from(out).filter((p) => p && !p.startsWith('_'));
    },

    /* входящие, пришедшие в inbox/out — это наши же исходящие, их не учитываем */
    inboxPeers() {
      const inbox = S.nodes.inbox || {};
      return Object.keys(inbox);
    },

    async deleteDialog(peer) {
      try {
        await Promise.all([
          api.del('accounts/' + enc(S.uid) + '/messages/' + enc(peer)),
          api.del('accounts/' + enc(S.uid) + '/chats/' + enc(peer)),
          api.del('accounts/' + enc(S.uid) + '/read/' + enc(peer))
        ]);
      } catch (e) { throw e; }
      if (S.nodes.acc.messages) delete S.nodes.acc.messages[peer];
      if (S.nodes.acc.chats) delete S.nodes.acc.chats[peer];
      bus.emit('chats');
      bus.emit('messages', peer);
    }
  };

  /* ============================ группы ============================ */
  const Groups = {
    get(gid) { return (S.nodes.chats && S.nodes.chats[gid]) || null; },
    list() {
      return Object.keys(S.nodes.chats || {}).filter((k) => k.startsWith('group_'));
    },
    title(gid) {
      const g = Groups.get(gid);
      return (g && g.name) || 'Группа';
    },
    avatar(gid) {
      const g = Groups.get(gid);
      return (g && g.avatar) || KG.avatarFallback(Groups.title(gid), gid);
    },
    members(gid) {
      const g = Groups.get(gid);
      return Object.keys((g && g.members) || {});
    },
    isMember(gid) {
      const g = Groups.get(gid);
      return !!(g && g.members && g.members[S.uid]);
    },
    isCreator(gid) {
      const g = Groups.get(gid);
      return !!(g && (g.creator === S.uid || g.createdBy === S.uid));
    },
    messages(gid) {
      return (gid === GLOBAL_KEY ? S.nodes.global : (S.groupMsgs[gid] || {}));
    },
    async loadMessages(gid) {
      if (!gid || gid === GLOBAL_KEY) return;
      if (S.groupMsgs[gid]) return;
      try {
        const data = await api.get('messages/' + enc(gid));
        S.groupMsgs[gid] = data || {};
        bus.emit('messages', gid);
      } catch (e) {}
    },
    async send(gid, payload) {
      const ts = now();
      const id = newId();
      const msg = Object.assign({ id, by: S.uid, byName: People.name(S.uid), byColor: People.color(S.uid), ts, type: 'text' }, payload);
      Object.keys(msg).forEach((k) => { if (msg[k] === undefined || msg[k] === null) delete msg[k]; });
      if (!S.groupMsgs[gid]) S.groupMsgs[gid] = {};
      S.groupMsgs[gid][id] = Object.assign({}, msg, { pending: true });
      bus.emit('messages', gid);
      try {
        await api.put('messages/' + enc(gid) + '/' + enc(id), msg);
        const mine = S.groupMsgs[gid][id];
        if (mine) delete mine.pending;
        bus.emit('messages', gid);
        return id;
      } catch (e) {
        const mine = S.groupMsgs[gid] && S.groupMsgs[gid][id];
        if (mine) { mine.pending = false; mine.failed = true; }
        bus.emit('messages', gid);
        throw e;
      }
    },
    summary(gid) {
      const g = Groups.get(gid) || {};
      const msgs = Groups.messages(gid);
      let last = null, lastTs = Number(g.createdAt || 0);
      for (const id in msgs) {
        const m = msgs[id];
        if (!m || typeof m !== 'object') continue;
        const t = Number(m.ts || 0);
        if (t >= lastTs) { lastTs = t; last = Object.assign({ id }, m); }
      }
      const readTs = Number((S.nodes.acc.read && S.nodes.acc.read[gid]) || 0);
      let unread = 0;
      for (const id in msgs) {
        const m = msgs[id];
        if (!m || typeof m !== 'object' || m.by === S.uid) continue;
        if (Number(m.ts || 0) > readTs) unread++;
      }
      const members = Groups.members(gid);
      const online = members.filter((m) => m !== S.uid && People.isOnline(m)).length;
      return {
        chatId: gid, kind: 'group', title: Groups.title(gid), avatar: Groups.avatar(gid),
        last, ts: lastTs, unread,
        subtitle: members.length + ' ' + KG.plural(members.length, 'участник', 'участника', 'участников') + (online ? ', ' + online + ' в сети' : ''),
        muted: !!S.muted[gid], pinned: !!S.pinned[gid], hidden: !!S.hidden[gid]
      };
    },
    async markRead(gid) {
      const ts = now();
      S.nodes.acc.read[gid] = ts;
      try { await api.put('accounts/' + enc(S.uid) + '/read/' + enc(gid), ts); } catch (e) {}
      bus.emit('read', gid);
    },
    async create(name, memberUids, avatar) {
      const gid = 'group_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const ts = now();
      const members = { [S.uid]: true };
      (memberUids || []).forEach((u) => { if (u !== S.uid) members[u] = true; });
      const group = {
        id: gid, name: String(name).slice(0, 50), avatar: avatar || '', createdAt: ts,
        creator: S.uid, createdBy: S.uid, members
      };
      await api.put('chats/' + gid, group);
      S.nodes.chats[gid] = group;
      S.groupMsgs[gid] = {};
      await api.put('messages/' + enc(gid) + '/' + enc(newId()), {
        by: 'system', ts: ts + 1, type: 'system',
        text: 'Группа «' + group.name + '» создана. Участников: ' + Object.keys(members).length
      });
      bus.emit('chats');
      return gid;
    },
    async update(gid, patch) {
      await api.patch('chats/' + gid, patch);
      S.nodes.chats[gid] = Object.assign({}, S.nodes.chats[gid], patch);
      bus.emit('chats');
    },
    async addMembers(gid, uids) {
      const patch = {};
      uids.forEach((u) => { patch[u] = true; });
      await api.patch('chats/' + gid + '/members', patch);
      const g = Groups.get(gid);
      if (g) g.members = Object.assign({}, g.members, patch);
      await api.put('messages/' + enc(gid) + '/' + enc(newId()), { by: 'system', ts: now(), type: 'system', text: uids.map((u) => People.name(u)).join(', ') + ' — добавлен(ы) в группу' });
      bus.emit('chats');
    },
    async kick(gid, uid) {
      await api.put('chats/' + gid + '/members/' + enc(uid), null);
      const g = Groups.get(gid);
      if (g && g.members) delete g.members[uid];
      await api.put('messages/' + enc(gid) + '/' + enc(newId()), { by: 'system', ts: now(), type: 'system', text: People.name(uid) + ' исключён(а) из группы' });
      bus.emit('chats');
    },
    async leave(gid) {
      await api.put('chats/' + gid + '/members/' + enc(S.uid), null);
      const g = Groups.get(gid);
      if (g && g.members) delete g.members[S.uid];
      try { await api.put('messages/' + enc(gid) + '/' + enc(newId()), { by: 'system', ts: now(), type: 'system', text: People.name(S.uid) + ' покинул(а) группу' }); } catch (e) {}
      bus.emit('chats');
    },
    async destroy(gid) {
      await api.del('chats/' + gid);
      await api.del('messages/' + gid);
      delete S.nodes.chats[gid];
      delete S.groupMsgs[gid];
      bus.emit('chats');
    }
  };

  /* ============================ сообщения (общие операции) ============================ */
  const Msgs = {
    /* универсальный доступ к хранилищу сообщений чата */
    store(chatId) {
      if (chatId === GLOBAL_KEY) return S.nodes.global;
      if (chatId.startsWith('group_')) return S.groupMsgs[chatId] || {};
      return Chat.messages(chatId);
    },
    list(chatId) {
      const raw = Msgs.store(chatId) || {};
      const hidden = chatId.startsWith('group_') || chatId === GLOBAL_KEY ? {} : (S.hiddenMsgs[chatId] || {});
      const out = [];
      for (const id in raw) {
        const m = raw[id];
        if (!m || typeof m !== 'object') continue;
        if (hidden[id] || hidden.__all) continue;
        out.push(Object.assign({ id }, m));
      }
      out.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
      return out;
    },
    isMine(m) {
      const me = S.uid;
      if (!m) return false;
      if (m.by) return m.by === me;
      return m.sender === me;
    },
    author(m) {
      if (!m) return '';
      if (m.by === 'system' || m.sender === 'system') return 'Kitogram';
      return m.by || m.sender || '';
    },
    authorName(m) {
      if (m.byName) return m.byName;
      return People.name(m.by || m.sender || '');
    },
    text(m) {
      if (!m) return '';
      return m.text || '';
    },
    reactions(m) {
      const r = (m && m.reactions) || {};
      return Object.keys(r).filter((e) => r[e] && Object.keys(r[e]).length);
    },
    async react(chatId, mid, emoji) {
      const me = S.uid;
      const raw = Msgs.store(chatId) || {};
      const m = raw[mid];
      const mine = !!(m && m.reactions && m.reactions[emoji] && m.reactions[emoji][me]);
      if (chatId === GLOBAL_KEY || chatId.startsWith('group_')) {
        try {
          await api.put('messages/' + enc(chatId) + '/' + enc(mid) + '/reactions/' + enc(emoji) + '/' + enc(me), mine ? null : true);
        } catch (e) { KG.toast('Не удалось поставить реакцию', true); }
        return;
      }
      try {
        const cur = Object.assign({}, (m && m.reactions) || {});
        const set = Object.assign({}, cur[emoji] || {});
        if (mine) delete set[me]; else set[me] = true;
        if (Object.keys(set).length) cur[emoji] = set; else delete cur[emoji];
        await api.put('accounts/' + enc(me) + '/messages/' + enc(chatId) + '/' + enc(mid) + '/reactions', cur);
        // получателю — тоже, чтобы увидеть реакцию у себя
        try { await api.put('inbox/' + enc(chatId) + '/' + enc(me) + '/' + mid + '/reactions', cur); } catch (e) {}
      } catch (e) { KG.toast('Не удалось поставить реакцию', true); }
    },
    async removeForAll(chatId, mid) {
      try {
        if (chatId === GLOBAL_KEY || chatId.startsWith('group_')) {
          await api.del('messages/' + enc(chatId) + '/' + enc(mid));
        } else {
          await api.del('accounts/' + enc(S.uid) + '/messages/' + enc(chatId) + '/' + enc(mid));
          // удалить у всех в личном чате нельзя (у собеседника своя копия) — только у себя
        }
        const st = Msgs.store(chatId);
        if (st) delete st[mid];
        bus.emit('messages', chatId);
      } catch (e) { KG.toast('Не удалось удалить', true); }
    },
    hideForMe(chatId, mid) {
      S.hiddenMsgs[chatId] = S.hiddenMsgs[chatId] || {};
      S.hiddenMsgs[chatId][mid] = true;
      KG.storage.jsonSet(KEY.hiddenMsgs, S.hiddenMsgs);
      bus.emit('messages', chatId);
    },
    forwardPayload(m) {
      return {
        type: m.type || 'text',
        text: m.text || '',
        src: m.src || '',
        thumb: m.thumb || '',
        poster: m.poster || '',
        duration: m.duration || 0,
        fwdFrom: m.byName || People.name(m.by || m.sender || ''),
        fwdType: m.type || 'text'
      };
    }
  };

  /* ============================ диалоги ============================ */
  const Dialogs = {
    all() {
      const items = [];
      Chat.peers().forEach((p) => items.push(Chat.summary(p)));
      Groups.list().forEach((gid) => {
        if (Groups.isMember(gid)) items.push(Groups.summary(gid));
      });
      const gsum = {
        chatId: GLOBAL_KEY, kind: 'global', title: 'Общий чат',
        avatar: KG.avatarFallback('О', 'global'), last: null, ts: 0,
        unread: 0, subtitle: 'для всех', muted: false, pinned: false, hidden: false
      };
      const gm = Groups.messages(GLOBAL_KEY);
      let last = null, ts = 0;
      for (const id in gm) {
        const m = gm[id];
        if (m && typeof m === 'object' && Number(m.ts || 0) >= ts) { ts = Number(m.ts); last = Object.assign({ id }, m); }
      }
      gsum.last = last; gsum.ts = ts;
      const readTs = Number((S.nodes.acc.read && S.nodes.acc.read[GLOBAL_KEY]) || 0);
      for (const id in gm) {
        const m = gm[id];
        if (m && m.by !== S.uid && Number(m.ts || 0) > readTs) gsum.unread++;
      }
      gsum.hidden = !!S.hidden[GLOBAL_KEY];
      items.push(gsum);
      return items.filter((i) => !i.hidden);
    },
    visible() {
      return Dialogs.all().filter((d) => d.last || d.chatId === GLOBAL_KEY || d.unread > 0 || d.kind === 'group');
    },
    sorted() {
      const items = Dialogs.visible();
      items.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.chatId === GLOBAL_KEY) return -1;
        if (b.chatId === GLOBAL_KEY) return 1;
        return (b.ts || 0) - (a.ts || 0);
      });
      return items;
    },
    find(chatId) {
      if (!chatId) return null;
      if (chatId === GLOBAL_KEY) return Dialogs.all().find((d) => d.chatId === GLOBAL_KEY);
      if (chatId.startsWith('group_')) {
        const g = Groups.get(chatId);
        return g ? Groups.summary(chatId) : null;
      }
      const c = Chat.summary(chatId);
      return (c.last || c.ts) ? c : null;
    },
    title(chatId) {
      if (chatId === GLOBAL_KEY) return 'Общий чат';
      if (chatId && chatId.startsWith('group_')) return Groups.title(chatId);
      return People.name(chatId);
    },
    avatar(chatId) {
      if (chatId === GLOBAL_KEY) return KG.avatarFallback('О', 'global');
      if (chatId && chatId.startsWith('group_')) return Groups.avatar(chatId);
      return People.avatar(chatId);
    },
    canOpen(chatId) {
      if (!chatId || !S.uid) return false;
      if (chatId === GLOBAL_KEY) return true;
      if (chatId.startsWith('group_')) return Groups.isMember(chatId);
      return chatId !== S.uid;
    }
  };

  /* ============================ непрочитанные/локальное ============================ */
  S.hiddenMsgs = KG.storage.json(KEY.hiddenMsgs, {});
  S.hidden = KG.storage.json(KEY.hidden, {});
  S.muted = KG.storage.json(KEY.muted, {});
  S.pinned = KG.storage.json(KEY.pinned, {});

  const persist = () => {
    KG.storage.jsonSet(KEY.hidden, S.hidden);
    KG.storage.jsonSet(KEY.muted, S.muted);
    KG.storage.jsonSet(KEY.pinned, S.pinned);
  };

  /* ============================ входящие ============================ */
  let inboxSeen = {};
  KG.resetInbox = () => { inboxSeen = {}; S.inboxPrimed = false; };

  const processInbox = () => {
    if (!S.uid) return;
    const inbox = S.nodes.inbox || {};
    let fresh = false;
    let lastTs = 0, lastPeer = '';
    Object.keys(inbox).forEach((from) => {
      const bucket = inbox[from];
      if (!bucket || typeof bucket !== 'object') return;
      Object.keys(bucket).forEach((mid) => {
        const m = bucket[mid];
        if (!m || typeof m !== 'object') return;
        const ts = Number(m.ts || 0);
        if (ts > lastTs) { lastTs = ts; lastPeer = from; }
        const dedupe = from + '/' + mid;
        if (inboxSeen[dedupe]) return;
        inboxSeen[dedupe] = true;
        if (!S.inboxPrimed) return;
        if (ts > (S.lastIncomingTs || 0)) fresh = true;
      });
    });
    if (!S.inboxPrimed) {
      // первый снимок после входа: это «старые» сообщения, не показываем всплывашку
      S.inboxPrimed = true;
      S.lastIncomingTs = lastTs;
      bus.emit('chats');
      bus.emit('messages', null);
      return;
    }
    if (lastTs > (S.lastIncomingTs || 0)) S.lastIncomingTs = lastTs;
    if (fresh) {
      bus.emit('chats');
      bus.emit('messages', null);
      if (!document.hidden) KG.sound.ping('in');
      bus.emit('incoming', { peer: lastPeer, ts: lastTs });
    }
  };

  /* гарантируем, что структура всегда полная — даже если пришёл null/одиночный объект */
  const ensureNodes = () => {
    const n = S.nodes;
    if (!n.acc || typeof n.acc !== 'object') n.acc = {};
    ['chats', 'messages', 'read'].forEach((k) => { if (!n.acc[k] || typeof n.acc[k] !== 'object') n.acc[k] = {}; });
    ['people', 'status', 'typing', 'seen', 'chats', 'global', 'inbox'].forEach((k) => { if (!n[k] || typeof n[k] !== 'object') n[k] = {}; });
  };
  bus.on('data', ensureNodes);

  bus.on('data', (e) => {
    if (e.key === 'inbox') processInbox();
    if (e.key === 'acc') {
      bus.emit('messages', e.path && e.path[0] === 'messages' ? (e.path[1] || null) : null);
      bus.emit('chats');
    }
    if (e.key === 'chats') bus.emit('chats');
    if (e.key === 'people') bus.emit('people');
    if (e.key === 'global') bus.emit('messages', GLOBAL_KEY);
  });

  KG.People = People;
  KG.Chat = Chat;
  KG.Groups = Groups;
  KG.Msgs = Msgs;
  KG.Dialogs = Dialogs;
  KG.login = login;
  KG.persistLocal = persist;
  KG.processInbox = processInbox;
})(window.KG);
