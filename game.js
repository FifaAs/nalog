/* «Налоговая мафия» — клиентская часть. Подключается из index.html до основного скрипта.
   Маршруты: #game (правила), #game-team (капитан команды), #game-screen (проектор),
   #game-host (ведущий), #game-print (карточки ролей и бланк команды). */
window.K8Game = (function () {
  "use strict";
  const TK = 'k8_game_team', HK = 'k8_game_host';
  const ROLE = {
    mafia: { n: 'Схемщики', night: 'Кого подставить этой ночью?', short: 'подставляет',
      d: 'Вы — ТОО, которое уводит налоги в серые схемы. Ночью вы «подставляете» другую команду: ей начисляется фиктивное нарушение −30, вам +15. Схема срабатывает, только если вы верно решили кейс.',
      goal: 'Дожить до конца игры и не попасть под выездную проверку (+50 в финале).' },
    inspector: { n: 'Инспектор КГД', night: 'Кого проверить этой ночью?', short: 'проверяет',
      d: 'Ночью вы проводите камеральную проверку одной команды и тайно узнаёте, схемщики ли это. Ордер на проверку выдаётся, только если вы верно решили кейс.',
      goal: 'Вычислить схемщиков и убедить остальных отправить их на выездную проверку.' },
    consultant: { n: 'Налоговый консультант', night: 'Кого защитить этой ночью?', short: 'защищает',
      d: 'Ночью вы защищаете одну команду (можно себя): если схемщики выбрали её, подстава сорвётся. Защита работает, только если вы верно решили кейс. Одну команду нельзя защищать два раза подряд.',
      goal: 'Сберечь капитал честных команд и помочь вычислить схемщиков.' },
    honest: { n: 'Добросовестное ТОО', night: 'Кого вы подозреваете?', short: 'подозревает',
      d: 'Вы честно платите налоги. Ночью решаете кейс и тайно отмечаете, кого подозреваете. Утром на экране покажут, сколько подозрений набрала каждая команда.',
      goal: 'Вычислить схемщиков голосованием и набрать максимум капитала.' }
  };
  const PHASE = { lobby: 'Регистрация команд', roles: 'Роли розданы', night: 'Ночь', day: 'Утро: разбор', vote: 'Голосование', verdict: 'Итог проверки', end: 'Игра окончена' };
  const L = ['А', 'Б', 'В', 'Г'];
  let C, h, $, view, dialog, store;
  let offset = 0;

  /* ---------- helpers ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tget = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const tset = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } };
  async function act(type, data) {
    let r; try { r = await fetch('/api/act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ type }, data || {})) }); }
    catch (e) { throw new Error('Нет связи с сервером. Проверьте интернет.'); }
    const j = await r.json().catch(() => ({ ok: false, error: 'Сервер недоступен.' }));
    if (!j.ok) throw new Error(j.error || 'Ошибка'); return j;
  }
  function connect(token, onState, onNet) {
    let es = null, closed = false;
    const open = () => {
      es = new EventSource('/api/stream?token=' + encodeURIComponent(token || ''));
      es.onopen = () => onNet && onNet(true);
      es.onmessage = e => { const s = JSON.parse(e.data); offset = s.now - Date.now(); onState(s); onNet && onNet(true); };
      es.onerror = () => { onNet && onNet(false); };
    };
    open();
    return () => { closed = true; es && es.close(); };
  }
  function fail(e) { dialog('<h3>Не получилось</h3><p>' + esc(e.message) + '</p>', [{ t: 'Понятно' }]); }
  function timerEl(deadline) { return deadline ? '<span class="g-timer" data-deadline="' + deadline + '">--:--</span>' : ''; }
  let tick = null;
  function startTick() {
    clearInterval(tick);
    const f = () => document.querySelectorAll('[data-deadline]').forEach(el => {
      const left = Math.max(0, Math.round((+el.dataset.deadline - (Date.now() + offset)) / 1000));
      el.textContent = left ? String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0') : 'Время вышло';
      el.classList.toggle('out', left <= 10);
    });
    f(); tick = setInterval(f, 500);
  }
  const roleLine = c => ['mafia', 'inspector', 'consultant', 'honest'].filter(r => c[r]).map(r => c[r] + ' × ' + ROLE[r].n).join(' · ');
  const netPill = () => h('<span class="g-net" data-net>подключение…</span>');
  const setNet = (root, ok) => { const n = root.querySelector('[data-net]'); if (n) { n.textContent = ok ? 'онлайн' : 'переподключение…'; n.classList.toggle('off', !ok); } };
  function shell(title, sub) {
    const w = h('<section class="wrap g-wrap"></section>');
    w.append(h('<div class="g-head"><div><div class="label">Налоговая мафия' + (sub ? ' · ' + sub : '') + '</div><h2>' + title + '</h2></div></div>'));
    view.append(w); return w;
  }
  function noServer(w) {
    w.append(h('<div class="warnbox"><h3>Игра работает только через сервер</h3><p>Сайт открыт как файл. Запустите <code>node server.js</code> и откройте <b>http://localhost:3000/#game</b>, или откройте сайт на хостинге.</p></div>'));
  }

  /* блок вопроса: answer — индекс выбранного, reveal — показывать верный */
  function qBlock(q, opts) {
    opts = opts || {};
    const b = h('<div class="g-q"><div class="label">' + esc(q.topic) + '</div><p class="g-qt">' + esc(q.text) + '</p><div class="g-opts"></div></div>');
    const o = b.querySelector('.g-opts');
    q.opts.forEach((t, i) => {
      const x = h('<button type="button" class="g-opt" aria-pressed="' + (opts.sel === i) + '"><span class="L">' + L[i] + '</span><span>' + esc(t) + '</span></button>');
      if (q.c != null) { if (i === q.c) x.classList.add('right'); else if (opts.sel === i) x.classList.add('wrong'); }
      if (opts.onPick) x.onclick = () => opts.onPick(i); else x.tabIndex = -1;
      o.appendChild(x);
    });
    if (q.c != null && q.expl) b.append(h('<div class="law" style="margin-top:12px"><b class="ref">ВЕРНО: ' + L[q.c] + ' · ' + esc(q.ref) + '</b>' + esc(q.expl) + '</div>'));
    return b;
  }
  function eventsBlock(res) {
    const b = h('<div class="g-evs"></div>');
    res.ev.forEach(e => b.append(h('<div class="g-ev ' + e.k + '">' + esc(e.txt) + '</div>')));
    return b;
  }
  function suspBlock(s) {
    const tot = Object.values(s.res.susp).reduce((a, b) => a + b, 0);
    if (!tot) return h('<p class="g-muted">Подозрений этой ночью не было.</p>');
    const b = h('<div class="g-susp"><div class="label">Подозрения добросовестных ТОО</div></div>');
    s.teams.map(t => [t, s.res.susp[t.id] || 0]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).forEach(([t, n]) =>
      b.append(h('<div class="g-srow"><span>' + esc(t.name) + '</span><span class="g-bar" style="width:' + Math.round(n / tot * 100) + '%"></span><b>' + n + '</b></div>')));
    return b;
  }
  function okGrid(s) {
    const g = h('<div class="g-teams"></div>');
    s.teams.forEach(t => { const ok = s.res.ok[t.id]; g.append(h('<span class="g-chip ' + (ok ? 'done' : 'miss') + '">' + (ok ? '✓ ' : '✗ ') + esc(t.name) + '</span>')); });
    return g;
  }
  function board(s, withMembers) {
    const rows = s.teams.slice().sort((a, b) => (b.cap || 0) - (a.cap || 0));
    const t = h('<div class="tbl"><table class="sm"><thead><tr><th>Место</th><th>Команда</th><th>Роль</th><th>Верных</th><th style="text-align:right">Капитал</th></tr></thead><tbody></tbody></table></div>');
    rows.forEach((x, i) => t.querySelector('tbody').append(h('<tr' + (x.role === 'mafia' ? ' class="g-maf"' : '') + '><td>' + (i + 1) + '</td><td><b>' + esc(x.name) + '</b>' + (withMembers ? '<br><span class="g-muted" style="font-size:.85rem">' + x.members.map(esc).join(', ') + '</span>' : '') + '</td><td>' + (x.role ? ROLE[x.role].n : '—') + '</td><td>' + x.correct + ' / ' + s.round + '</td><td class="n-right">' + (x.cap != null ? x.cap : '—') + '</td></tr>')));
    return t;
  }
  function winnerBlock(s) {
    const honest = s.winner === 'honest';
    return h('<div class="g-win ' + (honest ? 'honest' : 'mafia') + '"><div class="label" style="color:inherit;opacity:.8">Победа</div><h3>' + (honest ? 'Честный бизнес и КГД: схемщики пойманы' : 'Схемщики: схему так и не раскрыли') + '</h3></div>');
  }

  /* ---------- #game: правила ---------- */
  function renderRules() {
    const w = shell('Групповая игра: налоговые кварталы, роли и выездные проверки', 'правила');
    w.append(h('<p class="lead" style="max-width:75ch">Аудитория делится на команды по 4–6 человек. Каждая команда получает одну тайную роль. Каждый раунд — это налоговый квартал: команды решают кейс по теме, ночью тайно действуют, днём обсуждают и голосуют, кого отправить на выездную проверку. Верный ответ на кейс — это и баллы, и сила роли.</p>'));
    const go = h('<div class="g-grid"></div>');
    [['Создать команду или войти по коду', 'Создать команду с названием и участниками или войти в уже созданную по коду. Роль, ответы и голос — на телефоне команды.', 'game-team', ''],
     ['Экран для проектора', 'Регистрация по QR, кейсы, разбор, итоги. Роли здесь не показываются.', 'game-screen', 'blue'],
     ['Панель ведущего', 'Управление раундами, тайная таблица ролей, экспорт результатов. Нужен PIN.', 'game-host', 'ghost'],
     ['Печать: карточки и бланк', 'Карточки ролей и бланк команды для записи решений — офлайн-компонент.', 'game-print', 'ghost']]
      .forEach(x => { const b = h('<button type="button" class="tile small g-go ' + x[3] + '"><h2 style="font-size:1.05rem">' + x[0] + '</h2><p>' + x[1] + '</p></button>'); b.onclick = () => { location.hash = x[2]; }; go.append(b); });
    w.append(go);
    w.append(h('<h3 class="g-h3">Роли</h3>'));
    const rc = h('<div class="g-grid"></div>');
    Object.keys(ROLE).forEach(r => rc.append(h('<div class="rolecard ' + r + '"><div class="label" style="color:inherit;opacity:.75">' + (r === 'honest' ? 'все остальные команды' : 'одна команда') + '</div><h3>' + ROLE[r].n + '</h3><p>' + ROLE[r].d + '</p><p><b>Цель:</b> ' + ROLE[r].goal + '</p></div>')));
    w.append(rc);
    w.append(h('<h3 class="g-h3">Ход квартала (≈ 5 минут)</h3>'));
    w.append(h('<div class="cols"><div class="box b"><h4>1. Ночь · 2 мин</h4><p>На экране кейс. Команда решает его на бланке, выбирает ответ на телефоне и тайно выбирает команду для своего действия. Действие срабатывает, только если ответ верный.</p></div><div class="box g"><h4>2. Утро · разбор</h4><p>Ведущий показывает верный ответ, норму НК РК и объяснение, кто ответил верно и что случилось ночью. Инспектор тайно узнаёт результат проверки.</p></div><div class="box b"><h4>3. День · 2 мин</h4><p>Обсуждение (можно блефовать) и голосование: кого отправить на выездную проверку. Можно воздержаться. При ничьей проверки нет.</p></div></div>'));
    w.append(h('<h3 class="g-h3">Капитал команды</h3>'));
    w.append(h('<div class="tbl"><table class="sm"><tbody>' +
      [['Старт', '100'], ['Верный ответ на кейс', '+20'], ['Фиктивное нарушение от схемщиков', '−30 (схемщикам +15)'], ['Ошибочная выездная проверка честной команды', '−20 этой команде'],
       ['Схемщики пойманы', 'схемщикам −50, остальным +20; игра окончена'], ['Схемщики не пойманы к концу', 'схемщикам +50']]
        .map(r => '<tr><td>' + r[0] + '</td><td class="n-right">' + r[1] + '</td></tr>').join('') + '</tbody></table></div>'));
    w.append(h('<div class="law blue"><b class="ref">ПОДСКАЗКА ДЛЯ ВЫЧИСЛЕНИЯ</b>Утром видно, какие команды ответили верно. Если схема «не сработала», значит схемщики ошиблись в кейсе — ищите среди команд с ✗. Капитал других команд скрыт до конца игры.</div>'));
    w.append(h('<div class="law"><b class="ref">ФИКСАЦИЯ РЕЗУЛЬТАТОВ</b>В конце ведущий выгружает таблицу «ФИО → команда → роль → верные ответы → капитал». Индивидуальная проверка — самостоятельная работа по именам (exit-ticket).</div>'));
    return null;
  }

  /* форма «название + участники» — для капитана и для ведущего */
  function teamForm(title, sub, btnText, withNet, onSubmit) {
    const picked = new Set(); let taken = new Set(), phase = 'lobby';
    const f = h('<div class="sheet g-join"></div>');
    f.append(h('<div><h3>' + title + '</h3><p class="g-muted">' + sub + '</p></div>'));
    if (withNet) f.append(netPill());
    const nm = h('<label class="f">Название команды<input maxlength="40" placeholder="Например: ТОО «Дебет-Кредит»"></label>');
    const nmi = nm.querySelector('input');
    const search = h('<input class="search" type="search" placeholder="Поиск по фамилии">');
    const grid = h('<div class="namegrid g-names"></div>');
    const chosen = h('<div class="g-teams"></div>');
    const extra = h('<div class="fields"><label class="f">Участник не из списка<input placeholder="Фамилия Имя"></label></div>');
    const addBtn = h('<button type="button" class="btn ghost" style="align-self:end">Добавить</button>'); extra.append(addBtn);
    const note = h('<div class="reveal"></div>');
    const go = h('<button type="button" class="btn" style="justify-self:start">' + btnText + '</button>');
    f.append(nm, h('<div class="label">Участники</div>'), search, grid, extra, chosen, note, go);
    const drawChosen = () => {
      chosen.innerHTML = '';
      picked.forEach(p => { const c = h('<button type="button" class="g-chip done" title="Убрать">' + esc(p) + ' ×</button>'); c.onclick = () => { picked.delete(p); drawGrid(); drawChosen(); }; chosen.append(c); });
      note.innerHTML = phase !== 'lobby' ? '<b style="color:var(--bad)">Игра уже началась — новые команды создать нельзя. Войдите в свою команду по коду.</b>' : picked.size ? 'Выбрано: <b>' + picked.size + '</b>' : 'Отметьте участников.';
      go.disabled = phase !== 'lobby';
    };
    function drawGrid() {
      const q = search.value.trim().toLowerCase(); grid.innerHTML = '';
      C.NAMES.filter(s => s.name.toLowerCase().includes(q)).forEach(s => {
        const busy = taken.has(s.name), on = picked.has(s.name);
        const b = h('<button type="button" class="nm' + (busy ? ' done' : '') + '" aria-pressed="' + on + '"><span class="no">' + s.no + '.</span><span>' + esc(s.name) + (busy ? ' · в команде' : '') + '</span></button>');
        b.onclick = () => { if (busy) return; on ? picked.delete(s.name) : picked.add(s.name); drawGrid(); drawChosen(); };
        grid.append(b);
      });
    }
    search.oninput = drawGrid;
    addBtn.onclick = () => { const i = extra.querySelector('input'); const v = i.value.trim(); if (v.length > 2) { picked.add(v); i.value = ''; drawChosen(); } };
    go.onclick = async () => {
      go.disabled = true;
      try { await onSubmit(nmi.value, [...picked]); nmi.value = ''; picked.clear(); search.value = ''; drawGrid(); drawChosen(); }
      catch (e) { fail(e); }
      go.disabled = phase !== 'lobby';
    };
    drawGrid(); drawChosen();
    return { el: f, update(s) { taken = new Set(s.teams.flatMap(t => t.members)); phase = s.phase; [...picked].forEach(p => taken.has(p) && picked.delete(p)); drawGrid(); drawChosen(); } };
  }

  /* ---------- #game-team ---------- */
  function renderTeam() {
    const w = shell('Команда', 'команда');
    if (location.protocol === 'file:') { noServer(w); return null; }
    const box = h('<div class="g-body"></div>'); w.append(box);
    let stop = null, showRole = false, sel = { round: -1, phase: '', a: null, t: null, v: null };
    const begin = () => { stop && stop(); box.innerHTML = ''; const tok = tget(TK); tok ? teamFlow(tok) : joinFlow(); };

    function joinFlow() {
      let mode = 'create';
      const tabs = h('<div class="g-tabs" role="tablist"><button type="button" class="g-tab" role="tab" data-m="create">Создать команду</button><button type="button" class="g-tab" role="tab" data-m="enter">Войти по коду</button></div>');
      const holder = h('<div></div>'); box.append(tabs, holder);
      const form = teamForm('Новая команда', 'Придумайте название и отметьте всех участников. После создания появится код команды — по нему остальные участники войдут со своих телефонов.', 'Создать команду', true,
        async (name, members) => { const r = await act('join', { name, members }); tset(TK, r.token); begin(); });
      const enter = h('<div class="sheet g-join"><div><h3>Войти в команду по коду</h3><p class="g-muted">Код из 4 символов виден на телефоне того, кто создал команду, и у ведущего. Войти можно на любом этапе игры.</p></div><label class="f">Код команды<input class="g-codein" maxlength="6" placeholder="K7P2" autocomplete="off" autocapitalize="characters"></label><button type="button" class="btn" style="justify-self:start">Войти</button></div>');
      const ei = enter.querySelector('input'), eb = enter.querySelector('button');
      const doEnter = async () => { eb.disabled = true; try { const r = await act('enter', { code: ei.value }); tset(TK, r.token); begin(); } catch (e) { fail(e); eb.disabled = false; } };
      eb.onclick = doEnter; ei.onkeydown = e => { if (e.key === 'Enter') doEnter(); };
      const show = m => { mode = m; tabs.querySelectorAll('.g-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.m === m))); holder.innerHTML = ''; holder.append(m === 'create' ? form.el : enter); if (m === 'enter') ei.focus(); };
      tabs.querySelectorAll('.g-tab').forEach(b => { b.onclick = () => show(b.dataset.m); });
      stop = connect('', s => { form.update(s); if (s.phase !== 'lobby' && mode === 'create') show('enter'); }, ok => setNet(form.el, ok));
      show('create');
    }

    function teamFlow(tok) {
      stop = connect(tok, s => {
        if (s.error === 'unknown_token') { tset(TK, null); begin(); return; }
        draw(s);
      }, ok => setNet(box, ok));
    }

    function draw(s) {
      const me = s.me, key = s.phase + s.round;
      if (sel.key !== key) { sel = { key, a: me.sub ? me.sub.a : null, t: me.sub ? me.sub.t : null, v: me.vote }; }
      box.innerHTML = '';
      const top = h('<div class="g-top"><div><div class="label">' + (s.round ? 'Квартал ' + s.round + ' из ' + s.maxRounds + ' · ' : '') + PHASE[s.phase] + '</div><h3>' + esc(me.name) + '</h3><p class="g-muted" style="font-size:.88rem">' + me.members.map(esc).join(', ') + '</p></div><div class="g-topr">' + timerEl(s.deadline) + '</div></div>');
      top.querySelector('.g-topr').append(netPill()); box.append(top);
      const codeRow = h('<div class="g-coderow"><span>Код команды: <b class="g-code">' + esc(me.code) + '</b></span><span class="g-muted" style="font-size:.88rem">Остальные участники вводят его на вкладке «Войти по коду» и видят всё то же на своих телефонах.</span></div>');
      const leave = h('<button type="button" class="btn ghost" style="padding:6px 12px;font-size:.85rem">Выйти на этом телефоне</button>');
      leave.onclick = () => dialog('<h3>Выйти из команды на этом телефоне?</h3><p>Команда останется в игре. Вернуться можно по коду <b>' + esc(me.code) + '</b>.</p>', [{ t: 'Отмена', cls: 'ghost' }, { t: 'Выйти', on: () => { tset(TK, null); begin(); } }]);
      codeRow.append(leave); box.append(codeRow);

      if (me.role) {
        const R = ROLE[me.role];
        const rc = h('<div class="g-secret"></div>');
        const tg = h('<button type="button" class="btn ghost g-rolebtn">' + (showRole ? 'Скрыть роль' : 'Показать нашу роль (тайно)') + '</button>');
        tg.onclick = () => { showRole = !showRole; draw(s); };
        rc.append(tg);
        if (showRole) {
          const card = h('<div class="rolecard ' + me.role + '"><div class="label" style="color:inherit;opacity:.75">Ваша роль · капитал ' + me.cap + '</div><h3>' + R.n + '</h3><p>' + R.d + '</p><p><b>Цель:</b> ' + R.goal + '</p></div>');
          if (me.intel.length) { const ul = h('<div class="g-intel"><div class="label" style="color:inherit;opacity:.75">Ночные отчёты</div></div>'); me.intel.slice().reverse().forEach(n => ul.append(h('<div class="g-int ' + n.tone + '">Кв. ' + n.round + ': ' + esc(n.txt) + '</div>'))); card.append(ul); }
          rc.append(card);
        }
        box.append(rc);
      }

      const P = s.phase;
      if (P === 'lobby') {
        box.append(h('<div class="reveal">Команда создана. Покажите код участникам, чтобы они вошли со своих телефонов. Ждём, пока ведущий начнёт игру. Команд: <b>' + s.teams.length + '</b>.</div>'));
      } else if (P === 'roles') {
        box.append(h('<div class="reveal">Роли розданы: ' + roleLine(s.counts) + '. Посмотрите свою роль так, чтобы не видели соседи. Ждём начала первого квартала.</div>'));
      } else if (P === 'night') {
        const R = ROLE[me.role];
        box.append(h('<div class="label">Шаг 1 · решите кейс</div>'));
        box.append(qBlock(s.q, { sel: sel.a, onPick: i => { sel.a = i; draw(s); } }));
        box.append(h('<div class="label" style="margin-top:6px">Шаг 2 · ' + (showRole ? R.night : 'ночное действие (смотрите роль)') + '</div>'));
        const g = h('<div class="g-pickteams"></div>');
        s.teams.forEach(t => {
          const self = t.id === me.id; if (self && me.role !== 'consultant') return;
          const blocked = me.role === 'consultant' && t.id === me.lastProtect;
          const b = h('<button type="button" class="g-opt" aria-pressed="' + (sel.t === t.id) + '"' + (blocked ? ' disabled' : '') + '><span>' + esc(t.name) + (self ? ' (мы)' : '') + (blocked ? ' — защищали прошлой ночью' : '') + (t.role ? ' · ' + ROLE[t.role].n : '') + '</span></button>');
          if (!blocked) b.onclick = () => { sel.t = t.id; draw(s); };
          g.append(b);
        });
        box.append(g);
        const sent = me.sub && me.sub.a === sel.a && me.sub.t === sel.t;
        const send = h('<button type="button" class="btn blue g-send"' + (sel.a == null || !sel.t ? ' disabled' : '') + '>' + (me.sub ? (sent ? 'Отправлено ✓' : 'Изменить ответ') : 'Отправить ответ и действие') + '</button>');
        send.onclick = async () => { send.disabled = true; try { await act('answer', { token: tok(), a: sel.a, t: sel.t }); } catch (e) { fail(e); send.disabled = false; } };
        box.append(send, h('<p class="g-muted" style="font-size:.88rem">' + (me.sub ? 'Ответ принят. Его можно изменить, пока ведущий не объявил утро.' : 'Ответ и действие отправляются вместе.') + ' Ответили ' + s.teams.filter(t => t.done).length + ' из ' + s.teams.length + '.</p>'));
      } else if (P === 'day' || P === 'vote' || P === 'verdict') {
        if (P === 'vote') {
          box.append(h('<div class="label">Голосование · кого отправить на выездную проверку?</div>'));
          const g = h('<div class="g-pickteams"></div>');
          s.teams.filter(t => t.id !== me.id).concat([{ id: 'skip', name: 'Воздержаться' }]).forEach(t => {
            const b = h('<button type="button" class="g-opt" aria-pressed="' + (sel.v === t.id) + '"><span>' + esc(t.name) + (t.role ? ' · ' + ROLE[t.role].n : '') + '</span></button>');
            b.onclick = () => { sel.v = t.id; draw(s); }; g.append(b);
          });
          const send = h('<button type="button" class="btn blue g-send"' + (!sel.v ? ' disabled' : '') + '>' + (me.vote ? (me.vote === sel.v ? 'Голос принят ✓' : 'Изменить голос') : 'Проголосовать') + '</button>');
          send.onclick = async () => { send.disabled = true; try { await act('cast', { token: tok(), t: sel.v }); } catch (e) { fail(e); send.disabled = false; } };
          box.append(g, send, h('<p class="g-muted" style="font-size:.88rem">Проголосовали ' + s.teams.filter(t => t.done).length + ' из ' + s.teams.length + '.</p>'));
        }
        if (P === 'verdict' && s.verdict) box.append(h('<div class="g-verdict ' + s.verdict.k + '">' + esc(s.verdict.txt) + '</div>'), h('<div class="reveal">Ждём следующий квартал.</div>'));
        if (s.res) {
          const ok = s.res.ok[me.id];
          box.append(h('<div class="g-ev ' + (ok ? 'saved' : 'hit') + '"><b>' + (ok ? 'Ваш ответ верный: +20.' : 'Ваш ответ неверный.') + '</b>' + (ok ? '' : ' Ночное действие не сработало.') + '</div>'));
          box.append(qBlock(s.q, { sel: me.sub ? me.sub.a : null }), eventsBlock(s.res), suspBlock(s));
        }
      } else if (P === 'end') {
        box.append(winnerBlock(s));
        if (s.verdict) box.append(h('<div class="g-verdict ' + s.verdict.k + '">' + esc(s.verdict.txt) + '</div>'));
        box.append(board(s, false));
      }
      startTick();
    }
    const tok = () => tget(TK);
    begin();
    return () => { stop && stop(); clearInterval(tick); };
  }

  /* ---------- #game-screen ---------- */
  function renderScreen() {
    document.body.classList.add('g-screen-mode');
    const w = shell('Экран игры', 'проектор'); w.classList.add('g-screen');
    if (location.protocol === 'file:') { noServer(w); return () => document.body.classList.remove('g-screen-mode'); }
    const box = h('<div class="g-body"></div>'); w.append(box);
    const stop = connect('screen', s => draw(s), ok => setNet(w, ok));
    w.querySelector('.g-head').append(netPill());
    function draw(s) {
      box.innerHTML = '';
      w.querySelector('.g-head h2').textContent = s.round ? 'Квартал ' + s.round + ' из ' + s.maxRounds + ' · ' + PHASE[s.phase] : PHASE[s.phase];
      const head = h('<div class="g-shead">' + timerEl(s.deadline) + (s.phase === 'night' || s.phase === 'vote' ? '<span class="g-count">' + (s.phase === 'night' ? 'Ответили' : 'Проголосовали') + ': <b>' + s.teams.filter(t => t.done).length + ' / ' + s.teams.length + '</b></span>' : '') + '</div>');
      if (head.textContent) box.append(head);
      const P = s.phase;
      if (P === 'lobby') {
        const url = location.origin + location.pathname + '#game-team';
        const g = h('<div class="g-lobby"><div class="g-qr"><div id="qrbox"></div><p class="mono" style="word-break:break-all">' + esc(url) + '</p><p>Отсканируйте QR: создайте команду или войдите в неё по коду команды.</p></div><div><div class="label">Команды: ' + s.teams.length + '</div><div class="g-tlist"></div></div></div>');
        s.teams.forEach(t => g.querySelector('.g-tlist').append(h('<div class="box"><h4>' + esc(t.name) + '</h4><p>' + t.members.map(esc).join(', ') + '</p></div>')));
        box.append(g);
        const qb = g.querySelector('#qrbox');
        if (window.QRCode) { try { new window.QRCode(qb, { text: url, width: 260, height: 260, correctLevel: window.QRCode.CorrectLevel.M }); } catch (e) { } }
      } else if (P === 'roles') {
        box.append(h('<div class="g-big">Роли розданы: ' + roleLine(s.counts) + '</div>'), h('<p class="lead">Капитаны, посмотрите роль на телефоне так, чтобы не видели другие команды. Сейчас начнётся первый квартал.</p>'));
        const rc = h('<div class="g-grid"></div>'); Object.keys(ROLE).filter(r => s.counts[r]).forEach(r => rc.append(h('<div class="rolecard ' + r + '"><h3>' + ROLE[r].n + '</h3><p>' + ROLE[r].d + '</p></div>'))); box.append(rc);
      } else if (P === 'night') {
        box.append(qBlock(s.q));
        const g = h('<div class="g-teams"></div>'); s.teams.forEach(t => g.append(h('<span class="g-chip ' + (t.done ? 'done' : '') + '">' + (t.done ? '✓ ' : '… ') + esc(t.name) + '</span>'))); box.append(g);
        box.append(h('<p class="g-muted">Решите кейс на бланке, затем капитан отправляет ответ и тайное ночное действие.</p>'));
      } else if (P === 'day' || P === 'vote' || P === 'verdict') {
        if (P === 'verdict' && s.verdict) box.append(h('<div class="g-verdict big ' + s.verdict.k + '">' + esc(s.verdict.txt) + '</div>'));
        if (P === 'vote') {
          box.append(h('<div class="g-big">Кого отправить на выездную проверку?</div>'));
          const g = h('<div class="g-teams"></div>'); s.teams.forEach(t => g.append(h('<span class="g-chip ' + (t.done ? 'done' : '') + '">' + (t.done ? '✓ ' : '… ') + esc(t.name) + (t.role ? ' · ' + ROLE[t.role].n : '') + '</span>'))); box.append(g);
        }
        if (s.res) {
          const cols = h('<div class="g-day"></div>');
          const l = h('<div></div>'); l.append(qBlock(s.q));
          const r = h('<div style="display:grid;gap:14px;align-content:start"></div>');
          r.append(h('<div class="label">Кто ответил верно</div>'), okGrid(s), h('<div class="label">События ночи</div>'), eventsBlock(s.res), suspBlock(s));
          cols.append(l, r); box.append(cols);
        }
      } else if (P === 'end') {
        box.append(winnerBlock(s));
        if (s.verdict) box.append(h('<div class="g-verdict ' + s.verdict.k + '">' + esc(s.verdict.txt) + '</div>'));
        box.append(board(s, true));
      }
      const revealed = s.teams.filter(t => t.role && P !== 'end');
      if (revealed.length) box.append(h('<p class="g-muted">Раскрыты проверкой: ' + revealed.map(t => esc(t.name) + ' — ' + ROLE[t.role].n).join('; ') + '</p>'));
      startTick();
    }
    return () => { stop(); clearInterval(tick); document.body.classList.remove('g-screen-mode'); };
  }

  /* ---------- #game-host ---------- */
  function renderHost() {
    const w = shell('Панель ведущего', 'ведущий');
    if (location.protocol === 'file:') { noServer(w); return null; }
    const box = h('<div class="g-body"></div>'); w.append(box);
    let stop = null, showRoles = false, ui = { qi: null, nsecs: '120', vsecs: '90', rounds: '5' };
    const begin = () => { stop && stop(); box.innerHTML = ''; const tk = tget(HK); tk ? flow(tk) : login(); };
    function login() {
      const f = h('<div class="sheet" style="display:grid;gap:14px;max-width:460px"><h3>Вход ведущего</h3><label class="f">PIN<input type="password" inputmode="numeric" placeholder="PIN"></label><button type="button" class="btn" style="justify-self:start">Войти</button></div>');
      const go = f.querySelector('button'), inp = f.querySelector('input');
      const run = async () => { try { const r = await act('login', { pin: inp.value }); tset(HK, r.token); begin(); } catch (e) { fail(e); } };
      go.onclick = run; inp.onkeydown = e => { if (e.key === 'Enter') run(); };
      box.append(f); inp.focus();
    }
    function flow(tk) {
      stop = connect(tk, s => { if (!s.host) { tset(HK, null); begin(); return; } draw(s); }, ok => setNet(box, ok));
    }
    const H = (type, data) => act(type, Object.assign({ token: tget(HK) }, data || {})).catch(fail);
    const sel = (opts, val, on) => { const x = h('<select>' + opts.map(o => '<option value="' + o[0] + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>'); x.onchange = () => on(x.value); return x; };
    const createForm = teamForm('Создать команду', 'Ведущий может заранее завести команды или создать команду для тех, у кого нет телефона. Код команды появится в таблице ниже — капитан вводит его на вкладке «Войти по коду».', 'Создать команду', false,
      async (name, members) => { const r = await act('create', { token: tget(HK), name, members }); dialog('<h3>Команда «' + esc(r.name) + '» создана</h3><p>Код для входа: <b class="g-code">' + esc(r.code) + '</b></p>', [{ t: 'Понятно' }]); });
    const TIMES = [['60', '1 мин'], ['90', '1,5 мин'], ['120', '2 мин'], ['180', '3 мин'], ['0', 'без таймера']];
    function draw(s) {
      box.innerHTML = '';
      const top = h('<div class="g-top"><div><div class="label">' + (s.round ? 'Квартал ' + s.round + ' из ' + s.maxRounds + ' · ' : '') + PHASE[s.phase] + '</div><h3>Команд: ' + s.teams.length + '</h3></div><div class="g-topr">' + timerEl(s.deadline) + '</div></div>');
      const scr = h('<a class="btn ghost" href="#game-screen" target="_blank" rel="noopener">Открыть экран для проектора ↗</a>');
      top.querySelector('.g-topr').append(netPill(), scr); box.append(top);
      const ctl = h('<div class="sheet g-ctl"></div>'); box.append(ctl);
      const P = s.phase;
      const btn = (t, cls, fn) => { const b = h('<button type="button" class="btn ' + (cls || '') + '">' + t + '</button>'); b.onclick = async () => { b.disabled = true; await fn(); b.disabled = false; }; return b; };
      const row = () => h('<div class="g-row"></div>');

      if (P === 'lobby') {
        ctl.append(h('<p>Покажите экран для проектора — там QR для регистрации. Когда все команды зарегистрировались, раздайте роли. Распределение: 1 схемщики, 1 инспектор КГД, 1 консультант (при 4+ командах), остальные — добросовестные ТОО.</p>'));
        const r = row(); r.append(h('<label class="f">Кварталов (раундов)</label>'));
        r.firstChild.append(sel([3, 4, 5, 6, 7, 8].map(n => [n, n + ' кв. ≈ ' + n * 5 + ' мин']), ui.rounds, v => { ui.rounds = v; }));
        r.append(btn('Раздать роли и начать', '', () => H('start', { rounds: +ui.rounds })));
        ctl.append(r);
        createForm.update(s); box.append(createForm.el);
      }
      if (P === 'roles' || P === 'verdict') {
        if (P === 'verdict' && s.verdict) ctl.append(h('<div class="g-verdict ' + s.verdict.k + '">' + esc(s.verdict.txt) + '</div>'));
        const free = s.bank.filter(q => !q.used);
        if (ui.qi == null || !s.bank[ui.qi] || s.bank[ui.qi].used) ui.qi = free.length ? free[0].i : 0;
        const r = row();
        const lq = h('<label class="f" style="flex:2 1 320px">Кейс для квартала ' + (s.round + 1) + '</label>'); lq.append(sel(s.bank.map(q => [q.i, (q.used ? '✓ ' : '') + (q.i + 1) + '. ' + q.topic + ' — ' + q.text.slice(0, 70) + '…']), ui.qi, v => { ui.qi = +v; draw(s); }));
        const lt = h('<label class="f">Таймер ночи</label>'); lt.append(sel(TIMES, ui.nsecs, v => { ui.nsecs = v; }));
        r.append(lq, lt, btn('Начать ночь · квартал ' + (s.round + 1), 'blue', () => H('night', { qi: ui.qi, secs: +ui.nsecs })));
        ctl.append(r);
        const q = s.bank[ui.qi]; ctl.append(h('<p class="g-muted" style="font-size:.9rem">' + esc(q.text) + ' <b>Верный: ' + L[q.c] + '</b></p>'));
        if (P === 'verdict') ctl.append(btn('Завершить игру досрочно', 'ghost', () => H('finish')));
      }
      if (P === 'night') {
        ctl.append(h('<p>Ответили <b>' + s.teams.filter(t => t.done).length + ' из ' + s.teams.length + '</b>. Когда все ответят или выйдет время — объявите утро. На экране появятся верный ответ и события ночи.</p>'));
        ctl.append(btn('Утро: подвести итоги ночи', '', () => H('morning')));
      }
      if (P === 'day') {
        ctl.append(h('<p>Разберите кейс по экрану: верный ответ, норма, типичная ошибка. Затем дайте 1–2 минуты на обсуждение и откройте голосование.</p>'));
        const r = row(); const lt = h('<label class="f">Таймер голосования</label>'); lt.append(sel(TIMES, ui.vsecs, v => { ui.vsecs = v; }));
        r.append(lt, btn('Открыть голосование', 'blue', () => H('vote', { secs: +ui.vsecs }))); ctl.append(r);
      }
      if (P === 'vote') {
        ctl.append(h('<p>Проголосовали <b>' + s.teams.filter(t => t.done).length + ' из ' + s.teams.length + '</b>.</p>'));
        ctl.append(btn('Подвести итоги голосования', '', () => H('tally')));
      }
      if (P === 'end') {
        ctl.append(winnerBlock(s));
        const r = row();
        r.append(btn('Скачать результаты (CSV для Excel)', '', async () => download(s)), btn('Новая партия с теми же командами', 'ghost', () => H('rematch')));
        ctl.append(r);
      }

      /* тайная таблица */
      const sec = h('<div class="sheet" style="display:grid;gap:12px"></div>');
      const tgl = h('<button type="button" class="btn ghost" style="justify-self:start">' + (showRoles ? 'Скрыть роли и ответы' : 'Показать роли и ответы (не на проектор!)') + '</button>');
      tgl.onclick = () => { showRoles = !showRoles; draw(s); };
      sec.append(h('<h3>Команды</h3>'), tgl);
      const t = h('<div class="tbl"><table class="sm"><thead><tr><th>Команда</th><th>Код</th><th>Участники</th><th>Роль</th><th>Ночь: ответ → цель</th><th>Голос</th><th>Верных</th><th style="text-align:right">Капитал</th><th></th></tr></thead><tbody></tbody></table></div>');
      const nm = id => { const x = s.all.find(y => y.id === id); return x ? x.name : id === 'skip' ? 'воздержались' : '—'; };
      s.all.forEach(x => {
        const tr = h('<tr><td><b>' + esc(x.name) + '</b></td><td class="mono"><b>' + esc(x.code || '') + '</b></td><td style="font-size:.85rem">' + x.members.map(esc).join(', ') + '</td><td>' + (showRoles && x.role ? ROLE[x.role].n : x.role ? '•••' : '—') + '</td><td>' + (x.sub ? (showRoles ? L[x.sub.a] + (s.q && s.q.c != null ? (x.sub.a === s.q.c ? ' ✓' : ' ✗') : '') + ' → ' + esc(nm(x.sub.t)) : 'отправлено') : '—') + '</td><td>' + (x.vote ? (showRoles ? esc(nm(x.vote)) : 'есть') : '—') + '</td><td>' + x.correct + '</td><td class="n-right">' + (showRoles ? x.cap : '•••') + '</td><td></td></tr>');
        if (P === 'lobby') { const k = h('<button type="button" class="btn ghost" style="padding:5px 10px;font-size:.85rem">Удалить</button>'); k.onclick = () => dialog('<h3>Удалить команду «' + esc(x.name) + '»?</h3>', [{ t: 'Отмена', cls: 'ghost' }, { t: 'Удалить', on: () => H('kick', { id: x.id }) }]); tr.lastChild.append(k); }
        t.querySelector('tbody').append(tr);
      });
      sec.append(t);
      const rs = h('<button type="button" class="btn ghost" style="justify-self:start;color:var(--bad)">Полный сброс игры (удалить команды)</button>');
      rs.onclick = () => dialog('<h3>Сбросить игру?</h3><p>Все команды, роли и результаты будут удалены. Перед этим скачайте CSV.</p>', [{ t: 'Отмена', cls: 'ghost' }, { t: 'Сбросить', on: () => H('reset') }]);
      sec.append(rs);
      box.append(sec);
      startTick();
    }
    function download(s) {
      const sorted = s.all.slice().sort((a, b) => b.cap - a.cap);
      const lines = ['ФИО;Команда;Роль;Верных ответов;Кварталов;Капитал команды;Место команды'];
      sorted.forEach((t, i) => t.members.forEach(m => lines.push([m, t.name, ROLE[t.role] ? ROLE[t.role].n : '', t.correct, s.round, t.cap, i + 1].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';'))));
      const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nalogovaya-mafiya-rezultaty.csv'; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    begin();
    return () => { stop && stop(); clearInterval(tick); };
  }

  /* ---------- #game-print ---------- */
  function renderPrint() {
    const w = shell('Карточки ролей и бланк команды', 'печать');
    const b = h('<button type="button" class="btn noprint" style="justify-self:start">Распечатать</button>'); b.onclick = () => window.print();
    w.append(h('<p class="g-muted noprint">Распечатайте карточки (по одной на команду, в конверте — как запасной вариант раздачи ролей) и бланк для каждой команды. Бланки сдаются ведущему вместе с итоговой таблицей.</p>'), b);
    const cards = h('<div class="g-print-cards"></div>');
    Object.keys(ROLE).forEach(r => cards.append(h('<div class="printcard rolecard ' + r + '"><div class="label" style="color:inherit;opacity:.75">Налоговая мафия · роль команды</div><h3>' + ROLE[r].n + '</h3><p>' + ROLE[r].d + '</p><p><b>Цель:</b> ' + ROLE[r].goal + '</p></div>')));
    w.append(cards);
    const rows = [1, 2, 3, 4, 5, 6].map(n => '<tr><td style="text-align:center"><b>' + n + '</b></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
    w.append(h('<div class="printcard g-blank"><div class="label">Налоговая мафия · бланк команды</div><h3 style="margin:6px 0 10px">Команда: ____________________________</h3><p style="margin-bottom:10px">Участники (ФИО): ______________________________________________________________________________</p><table class="g-blank-t"><thead><tr><th>Кв.</th><th>Решение / расчёт</th><th>Ответ</th><th>Норма НК РК / КоАП</th><th>Ночное действие (кого)</th><th>Голос днём</th></tr></thead><tbody>' + rows + '</tbody></table><p style="margin-top:10px;font-size:.85rem">За каждый кейс: верный ответ на телефоне + записанное решение и норма на бланке. Бланк сдаётся ведущему.</p></div>'));
    return null;
  }

  return {
    render(id, ctx) {
      C = ctx; h = ctx.h; $ = ctx.$; view = ctx.view; dialog = ctx.dialog; store = ctx.store;
      view.innerHTML = '';
      if (id === 'game-team') return renderTeam();
      if (id === 'game-screen') return renderScreen();
      if (id === 'game-host') return renderHost();
      if (id === 'game-print') return renderPrint();
      return renderRules();
    }
  };
})();
