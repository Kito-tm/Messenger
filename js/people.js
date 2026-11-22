/* =========================================================================
   Kitogram 4.1 — люди: надёжный поиск без зависимости от realtime-потока

   Проблема: раньше список людей приходил только через SSE-поток. Если прокси
   или браузер его режет (или поток ещё не успел подняться), поиск был пустым:
   «Kito» и «@Kito» ничего не находили, хотя аккаунт есть.

   Теперь People.boot():
      1) мгновенный REST-запрос people.json  (работает всегда, отдаёт сразу
         объект со всеми профилями);
      2) фоновый realtime-поток для живых обновлений;
      3) повторные попытки, если база не ответила.
   ========================================================================= */
(function (KG) {
  'use strict';

  const { enc, now, bus, S, api } = KG;

  const Search = {
    ready: false,
    loading: false,
    lastError: '',
    attempts: 0,

    /* нормализация запроса: «Kito», « @Kito », «@ kito», «Кито» -> без лишнего */
    normalize(q) {
      let v = String(q == null ? '' : q).toLowerCase().replace(/\s+/g, ' ').trim();
      try {
        v = v.replace(/[^\p{L}\p{N}_.\-@ ]/gu, '');
      } catch (e) {
        v = v.replace(/[^a-zа-яё0-9_.\-@ ]/gi, '');
      }
      return v.trim();
    },
    needle(q) { return Search.normalize(q).replace(/^@+/, '').trim(); },

    /* все известные люди: people + профили из моих чатов */
    all() {
      const out = new Set(Object.keys(S.nodes.people || {}));
      Object.keys((S.nodes.acc && S.nodes.acc.chats) || {}).forEach((p) => out.add(p));
      Object.keys(S.nodes.inbox || {}).forEach((p) => out.add(p));
      Object.keys((S.nodes.acc && S.nodes.acc.messages) || {}).forEach((p) => out.add(p));
      out.delete(S.uid);
      out.delete('system');
      return Array.from(out).filter((u) => u && u.indexOf('@') === 0);
    },

    /* скоринг: точное совпадение логина > префикс логина > имя > вхождение */
    score(uid, q) {
      if (!q) return 1;
      const login = uid.replace(/^@+/, '').toLowerCase();
      const name = String(KG.People.name(uid) || '').toLowerCase();
      const flat = (v) => String(v || '').replace(/[_\-. ]/g, '').replace(/ё/g, 'е');
      const loginFlat = flat(login);
      const nameFlat = flat(name);
      const qFlat = flat(q);
      if (login === q) return 100;
      if (loginFlat === qFlat) return 96;
      if (login.startsWith(q)) return 90;
      if (loginFlat.startsWith(qFlat)) return 86;
      if (name === q) return 84;
      if (nameFlat === qFlat) return 80;
      if (name.startsWith(q)) return 74;
      if (nameFlat.startsWith(qFlat)) return 70;
      if (login.includes(q)) return 60;
      if (loginFlat.includes(qFlat)) return 56;
      if (name.includes(q)) return 50;
      if (nameFlat.includes(qFlat)) return 46;
      return 0;
    },

    find(query) {
      const q = Search.needle(query);
      const list = Search.all()
        .map((uid) => ({ uid, score: Search.score(uid, q) }))
        .filter((it) => it.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          const ao = KG.People.isOnline(a.uid) ? 0 : 1;
          const bo = KG.People.isOnline(b.uid) ? 0 : 1;
          if (ao !== bo) return ao - bo;
          return KG.People.name(a.uid).localeCompare(KG.People.name(b.uid), 'ru');
        });
      return list.map((it) => it.uid);
    }
  };

  const Loader = {
    /* старые аккаунты лежат в users/<ключ> (схема 3.0). Приводим их к виду people/@login */
    async fetchLegacy() {
      try {
        const data = await api.get('users');
        if (!data || typeof data !== 'object') return 0;
        // один человек мог сохраниться под двумя ключами: "kito_god" и "@Kito_god"
        const best = new Map();
        Object.keys(data).forEach((raw) => {
          const bare = String(raw).replace(/^@+/, '').trim();
          if (!bare || /[.#$\[\]\/]/.test(bare)) return;
          const lower = bare.toLowerCase();
          const hasAt = String(raw).charAt(0) === '@';
          const prev = best.get(lower);
          // приоритет: ключ с @ и более «полная» запись
          if (!prev || (hasAt && !prev.hasAt) || (hasAt === prev.hasAt && Object.keys(data[raw] || {}).length > Object.keys(prev.data || {}).length)) {
            best.set(lower, { raw, bare, hasAt, data: data[raw] || {} });
          }
        });
        let added = 0;
        best.forEach((rec) => {
          const uid = '@' + rec.bare.toLowerCase();
          if (uid === S.uid) return;
          if ((S.nodes.people || {})[uid]) return;
          const d = rec.data || {};
          const name = d.displayName || d.nickname || rec.bare;
          const avatar = d.avatar || d.photo || '';
          S.nodes.people[uid] = {
            uid, login: rec.bare.toLowerCase(), displayName: name, name,
            avatarThumb: /^(data:|https?:)/.test(String(avatar)) && avatar.length < 120000 ? avatar : '',
            color: d.userColor || d.color || KG.uidColor(uid),
            legacy: true, lastSeen: Number(d.lastSeen || 0) || 0, online: !!d.online
          };
          added++;
        });
        if (added) {
          S.usersLoaded = true;
          bus.emit('people');
          bus.emit('people-ready');
        }
        return added;
      } catch (e) { return 0; }
    },

    /* загрузка списка людей через REST — не зависит от SSE */
    async fetchAll(force) {
      if (Loader.busy) return S.usersLoaded;
      Loader.busy = true;
      Search.loading = true;
      bus.emit('people-loading', true);
      try {
        const data = await api.get('people', { shallow: 'false' });
        if (data && typeof data === 'object') {
          const incoming = {};
          Object.keys(data).forEach((k) => {
            const v = data[k];
            if (!v || typeof v !== 'object' || !k || k.charAt(0) !== '@') return;
            incoming[k] = v;
          });
          // не теряем то, что уже пришло потоком
          S.nodes.people = Object.assign({}, S.nodes.people || {}, incoming);
          S.usersLoaded = true;
          Search.ready = true;
          Search.lastError = '';
          Search.attempts = 0;
          await Loader.fetchLegacy();
          bus.emit('people');
          bus.emit('people-ready');
          return true;
        }
        Search.lastError = 'empty';
        return false;
      } catch (e) {
        Search.lastError = e && e.message ? e.message : 'error';
        // запасной путь: shallow-список ключей, чтобы поиск работал хотя бы по логинам
        try {
          const keys = await api.get('people', { shallow: 'true' });
          if (keys && typeof keys === 'object') {
            const incoming = {};
            Object.keys(keys).forEach((k) => {
              if (k && k.charAt(0) === '@' && !(S.nodes.people || {})[k]) {
                incoming[k] = { uid: k, login: k.replace(/^@+/, ''), displayName: k.replace(/^@+/, '') };
              }
            });
            if (Object.keys(incoming).length) {
              S.nodes.people = Object.assign({}, S.nodes.people || {}, incoming);
              S.usersLoaded = true;
              bus.emit('people');
              bus.emit('people-ready');
              return true;
            }
          }
        } catch (e2) { /* нет сети */ }
        return false;
      } finally {
        Loader.busy = false;
        Search.loading = false;
        bus.emit('people-loading', false);
      }
    },

    /* повторные попытки: 1с, 3с, 7с, 15с */
    retry(delays) {
      const list = delays || [1000, 3000, 7000, 15000];
      list.forEach((ms, i) => setTimeout(() => {
        if (S.uid && !S.usersLoaded) Loader.fetchAll(true);
        if (i === list.length - 1 && !S.usersLoaded) Loader.fetchAll(true);
      }, ms));
    },

    async boot() {
      if (!S.uid) return;
      const ok = await Loader.fetchAll(true);
      await Loader.fetchLegacy();
      if (!ok) Loader.retry();
    }
  };

  /* первый снимок из потока тоже считается загрузкой */
  bus.on('data', (e) => {
    if (e.key !== 'people') return;
    S.usersLoaded = true;
    Search.ready = true;
  });

  KG.SearchPeople = Search;
  KG.PeopleLoader = Loader;
  KG.People.boot = () => Loader.boot();
  KG.People.fetchAll = () => Loader.fetchAll(true);
})(window.KG);
