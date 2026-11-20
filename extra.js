/* Работа на закрепление (#practice), панель ведущих (#admin) и экран для проектора (#screen).
   Данные — через window.K8DB (Supabase или этот браузер), задания — window.K8_CASES. */
window.K8X = (function () {
  "use strict";
  let C, h, $, view, dialog;
  const DB = () => window.K8DB;
  const BANK = () => window.K8_CASES;
  const L = ['А', 'Б', 'В', 'Г'];
  const ROLE = { mafia: 'Схемщики', consultant: 'Консультант', mimic: 'Мимик', auditor: 'Аудитор' };
  const ROLE_CLS = { mafia: 'r-mafia', consultant: 'r-cons', mimic: 'r-mimic', auditor: 'r-aud' };
  const QN = 5;
  const plural = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };
  const SS = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { } }
  };
  const fail = e => dialog('<h3>Не получилось</h3><p>' + esc(e.message || e) + '</p>', [{ t: 'Понятно' }]);
  const dbNote = () => DB().online ? '' : '<div class="warnbox"><h3>База не подключена</h3><p>Supabase ещё не настроен (public/config.js), поэтому данные хранятся только в этом браузере. Экран проектора обновляется, если он открыт на этом же компьютере.</p></div>';
  function copyText(btn, text, holder) {
    const done = () => { btn.textContent = 'Скопировано'; };
    try { navigator.clipboard.writeText(text).then(done, () => fallback()); } catch (e) { fallback(); }
    function fallback() { const ta = h('<textarea style="width:100%;min-height:120px;font-family:var(--mono)"></textarea>'); ta.value = text; holder.append(ta); ta.select(); }
  }

  /* =================== РАБОТА НА ЗАКРЕПЛЕНИЕ =================== */
  const KP = 'k8_practice_v1';
  function renderPractice() {
    const qs = BANK().practice;
    const w = h('<section class="wrap"><div class="sheet pr-sheet"></div></section>'); const sh = w.firstElementChild; view.append(w);
    const mine = LS.get(KP, null);
    if (mine && !mine.synced) syncPractice(mine);
    start();

    function start() {
      sh.innerHTML = '';
      sh.append(h('<div><div class="label">Работа на закрепление · 10 вопросов · 10 баллов</div><h2 style="font-size:1.7rem;margin-top:6px">Закрепим все пять тем</h2><p class="pr-lead">По 2 вопроса на каждую тему. После каждого ответа сразу видно, почему он верный или неверный, и какая норма НК РК это определяет. Балл ставится за первый ответ, всего — 10 баллов.</p></div>'));
      const m = LS.get(KP, null);
      if (m) {
        sh.append(h('<div class="reveal"><b>' + esc(m.name) + '</b>, вы уже прошли работу: <b>' + m.score + ' / 10</b>. ' + (m.synced || !DB().online ? '' : 'Результат ещё отправляется в журнал.') + '</div>'));
        const again = h('<button class="btn blue" type="button" style="justify-self:start">Пройти ещё раз для тренировки (без баллов)</button>');
        again.onclick = () => quiz(null);
        const ex = h('<button class="btn ghost" type="button" style="justify-self:start">Перейти к Exit-ticket →</button>'); ex.onclick = () => { location.hash = 'work'; };
        sh.append(again, ex); return;
      }
      const search = h('<input class="search" type="search" placeholder="Начните вводить фамилию">');
      const grid = h('<div class="namegrid" role="listbox" aria-label="Список студентов"></div>');
      const info = h('<div class="reveal">Выберите своё имя.</div>');
      const go = h('<button class="btn" type="button" disabled style="justify-self:start">Начать</button>');
      let sel = null, done = new Set();
      const draw = () => {
        const q = search.value.trim().toLowerCase(); grid.innerHTML = '';
        C.NAMES.filter(s => s.name.toLowerCase().includes(q)).forEach(s => {
          const isDone = done.has(s.no);
          const b = h('<button type="button" class="nm' + (isDone ? ' done' : '') + '" aria-pressed="' + (sel === s) + '"><span class="no">' + s.no + '.</span><span>' + esc(s.name) + (isDone ? ' · пройдено' : '') + '</span></button>');
          b.onclick = () => { if (isDone) { info.innerHTML = '<b style="color:var(--bad)">Под этим именем работа уже пройдена.</b>'; return; } sel = s; info.innerHTML = '<b>' + esc(s.name) + '</b>'; go.disabled = false; draw(); };
          grid.append(b);
        });
      };
      search.oninput = draw; draw();
      DB().submitted('practice').then(n => { n.forEach(x => done.add(x)); if (sel && done.has(sel.no)) { sel = null; go.disabled = true; } draw(); }).catch(() => { });
      go.onclick = () => { if (sel) quiz(sel); };
      sh.append(search, grid, info, go);
    }

    function quiz(student) {
      let i = 0, score = 0; const answers = [];
      const step = () => {
        sh.innerHTML = '';
        const q = qs[i];
        const head = h('<div class="pr-head"><span class="label">' + (student ? esc(student.name) : 'Тренировка без баллов') + '</span><span class="pr-score">Баллы: <b>' + score + '</b> / 10</span></div>');
        const bar = h('<div class="pr-bar" aria-hidden="true"></div>'); for (let k = 0; k < qs.length; k++) bar.append(h('<i class="' + (k < i ? (answers[k] === qs[k].c ? 'ok' : 'no') : k === i ? 'cur' : '') + '"></i>'));
        const card = h('<div class="pr-q"><div class="label">Вопрос ' + (i + 1) + ' из ' + qs.length + ' · ' + esc(q.topic) + '</div><h3>' + esc(q.text) + '</h3><div class="pr-opts"></div><div class="pr-why" hidden></div></div>');
        const opts = card.querySelector('.pr-opts'), why = card.querySelector('.pr-why');
        const next = h('<button class="btn" type="button" hidden style="justify-self:start">' + (i < qs.length - 1 ? 'Следующий вопрос →' : 'Завершить') + '</button>');
        q.opts.forEach((o, j) => {
          const b = h('<button type="button" class="pr-opt"><span class="L">' + L[j] + '</span><span>' + esc(o) + '</span></button>');
          b.onclick = () => {
            if (answers[i] != null) return;
            answers[i] = j; const ok = j === q.c; if (ok) score++;
            opts.querySelectorAll('.pr-opt').forEach((x, k) => { x.disabled = true; if (k === q.c) x.classList.add('right'); else if (k === j) x.classList.add('wrong'); });
            why.hidden = false;
            why.innerHTML = '<div class="pr-verdict ' + (ok ? 'ok' : 'no') + '">' + (ok ? '✓ Верно' : '✗ Неверно') + (student ? (ok ? ' · +1 балл' : ' · 0 баллов') : '') + '</div>' +
              '<p><b>Ваш ответ («' + L[j] + '»):</b> ' + esc(q.why[j]) + '</p>' +
              (ok ? '' : '<p><b>Верный ответ («' + L[q.c] + '»):</b> ' + esc(q.why[q.c]) + '</p>') +
              '<span class="ref-s">' + esc(q.ref) + '</span>';
            head.querySelector('.pr-score b').textContent = score;
            next.hidden = false; next.focus();
          };
          opts.append(b);
        });
        next.onclick = () => { i++; if (i < qs.length) step(); else finish(); };
        sh.append(head, bar, card, next);
      };
      const finish = () => {
        sh.innerHTML = '';
        sh.append(h('<div class="result"><div class="label">' + (student ? 'Работа на закрепление пройдена' : 'Тренировка завершена') + '</div>' + (student ? '<h2 style="font-size:1.4rem">' + esc(student.name) + '</h2>' : '') + '<div class="score">' + score + ' / 10</div></div>'));
        if (student) {
          const rec = { no: student.no, name: student.name, score, answers, synced: false, at: new Date().toISOString() };
          LS.set(KP, rec);
          const st = h('<div class="reveal">' + (DB().online ? 'Сохраняем результат в журнал…' : 'Результат сохранён на этом устройстве.') + '</div>'); sh.append(st);
          if (DB().online) syncPractice(rec).then(ok => { st.innerHTML = ok ? '<b style="color:var(--green-2)">✓ Результат сохранён в общем журнале.</b>' : '<b style="color:var(--bad)">Нет связи с базой.</b> Не очищайте браузер — результат отправится при следующем открытии сайта.'; });
        }
        const rev = h('<div class="pr-review"><h3>Разбор всех вопросов</h3></div>');
        qs.forEach((q, k) => { const ok = answers[k] === q.c; rev.append(h('<div class="pr-ritem ' + (ok ? 'ok' : 'no') + '"><b>' + (k + 1) + '. ' + esc(q.text) + '</b><p>Верный ответ: <b>' + L[q.c] + ') ' + esc(q.opts[q.c]) + '</b>' + (ok ? '' : ' · ваш ответ: ' + L[answers[k]] + ') ' + esc(q.opts[answers[k]])) + '</p><p class="pr-rw">' + esc(q.why[q.c]) + ' <span class="ref-s">' + esc(q.ref) + '</span></p></div>')); });
        const ex = h('<button class="btn" type="button" style="justify-self:start">Перейти к Exit-ticket →</button>'); ex.onclick = () => { location.hash = 'work'; };
        const again = h('<button class="btn ghost" type="button" style="justify-self:start">Пройти ещё раз для тренировки</button>'); again.onclick = () => quiz(null);
        sh.append(rev, ex, again);
      };
      step();
    }
    return null;
  }
  async function syncPractice(rec) {
    if (!DB().online) return false;
    try { await DB().insert('practice', { no: rec.no, name: rec.name, score: rec.score, max: 10, answers: rec.answers }); const m = LS.get(KP, null); if (m && m.no === rec.no) { m.synced = true; LS.set(KP, m); } return true; }
    catch (e) { return false; }
  }

  /* =================== ЭКРАН ДЛЯ ПРОЕКТОРА =================== */
  function itemOf(d) {
    if (!d || !d.kind) return null;
    const list = BANK()[d.kind]; return list ? list[d.idx] : null;
  }
  const KIND = { main: 'Кейс квартала', extra: 'Дополнительный кейс', oral: 'Устный вопрос' };
  function renderScreen() {
    document.body.classList.add('screen-mode');
    const w = h('<section class="scr"><div class="scr-top"><span class="label" id="scrLabel">Налоговая мафия · экран</span><span class="scr-timer" id="scrTimer" hidden></span></div><div class="scr-body" id="scrBody"></div></section>');
    view.append(w);
    let data = {}, tick = null;
    const draw = () => {
      const body = w.querySelector('#scrBody'), it = itemOf(data);
      if (data.kind === 'join') {
        w.querySelector('#scrLabel').textContent = 'Налоговая мафия · регистрация команд'; body.innerHTML = '';
        const j = h('<div class="scr-join"><div class="scr-qr" id="scrQr"></div><div><h1 class="scr-q">Зарегистрируйте команду</h1><p class="scr-steps">1. Откройте ссылку на одном телефоне команды<br>2. Введите название и отметьте участников<br>3. Тайно посмотрите роль</p><p class="scr-url">' + esc(data.url || '') + '</p></div></div>');
        body.append(j);
        if (window.QRCode) { try { new window.QRCode(j.querySelector('#scrQr'), { text: data.url || '', width: 280, height: 280, correctLevel: window.QRCode.CorrectLevel.M }); } catch (e) { } }
        return;
      }
      if (data.kind === 'scores') {
        w.querySelector('#scrLabel').textContent = 'Налоговая мафия · итоги игры'; body.innerHTML = '';
        body.append(h('<h1 class="scr-q">Итоговая таблица</h1>'));
        const R = window.K8G ? window.K8G.ROLE : {};
        const t = h('<div class="scr-scores"></div>');
        (data.rows || []).forEach((x, i) => t.append(h('<div class="scr-srow' + (i === 0 ? ' first' : '') + '"><span class="n">' + (i + 1) + '</span><span class="nm">' + esc(x.name) + '</span><span class="rl">' + esc(R[x.role] ? R[x.role].n : '') + '</span><b>' + x.total + '</b></div>')));
        body.append(t); return;
      }
      w.querySelector('#scrLabel').textContent = (data.label ? data.label + ' · ' : '') + (it ? KIND[data.kind] : 'Налоговая мафия');
      body.innerHTML = '';
      if (!it) { body.append(h('<div class="scr-idle"><div class="scr-logo">8</div><h1>Налоговая мафия</h1><p>Ждём следующий кейс…</p></div>')); return; }
      body.append(h('<div class="label">' + esc(it.topic) + '</div>'), h('<h1 class="scr-q">' + esc(it.text) + '</h1>'));
      if (it.opts) {
        const o = h('<div class="scr-opts"></div>');
        it.opts.forEach((x, j) => o.append(h('<div class="scr-opt' + (data.reveal && j === it.c ? ' right' : '') + (data.reveal && j !== it.c ? ' dim' : '') + '"><span class="L">' + L[j] + '</span><span>' + esc(x) + '</span></div>')));
        body.append(o);
        if (data.reveal) body.append(h('<div class="scr-expl"><b>Верно: ' + L[it.c] + '.</b> ' + esc(it.expl) + ' <span class="ref-s">' + esc(it.ref) + '</span></div>'));
      } else if (data.reveal) body.append(h('<div class="scr-expl"><b>Ответ:</b> ' + esc(it.answer) + '</div>'));
    };
    const timer = () => {
      const el = w.querySelector('#scrTimer');
      if (!data.ends) { el.hidden = true; return; }
      const left = Math.max(0, Math.round((data.ends - Date.now()) / 1000));
      el.hidden = false; el.textContent = left ? String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0') : 'Время вышло';
      el.classList.toggle('out', left <= 10);
    };
    const apply = d => { data = d || {}; draw(); timer(); };
    DB().getScreen().then(apply).catch(() => apply({}));
    const off = DB().watchScreen(apply);
    tick = setInterval(timer, 500);
    return () => { off(); clearInterval(tick); document.body.classList.remove('screen-mode'); };
  }

  /* =================== ПАНЕЛЬ ВЕДУЩИХ =================== */
  const blankQ = () => ({ caseIdx: null, ans: {}, mv: {}, extra: null, aud: {} });
  const blankGame = () => ({ teams: [], q: Array.from({ length: QN }, blankQ), cur: 0 });
  function rolesFor(n) { const r = ['mafia', 'consultant']; if (n >= 4) r.push('mimic'); while (r.length < n) r.push('auditor'); return r; }

  /* подсчёт очков по правилам: кейс +10; ход — только при верном ответе */
  function score(g) {
    const T = g.teams, by = id => T.find(t => t.id === id), one = r => T.find(t => t.role === r);
    const pts = {}; T.forEach(t => { pts[t.id] = Array(QN).fill(0); });
    const info = g.q.map((q, i) => {
      const ok = id => q.ans[id] === true;
      T.forEach(t => { if (ok(t.id)) pts[t.id][i] += 10; });
      const maf = one('mafia'), con = one('consultant'), mim = one('mimic');
      const prot = con && ok(con.id) ? q.mv[con.id] : null;
      const r = { scheme: 'none', victim: null, target: null, audits: {} };
      if (maf) {
        const tg = q.mv[maf.id]; r.target = tg || null;
        if (!ok(maf.id) || !tg || !by(tg)) r.scheme = q.ans[maf.id] === false ? 'wrong' : 'none';
        else if (mim && tg === mim.id) { r.scheme = 'trap'; pts[mim.id][i] += 15; }
        else if (tg === prot) { r.scheme = 'saved'; pts[con.id][i] += 5; }
        else {
          r.scheme = 'victim'; r.victim = tg;
          if (q.extra === true) pts[tg][i] += 5;
          else if (q.extra === false) { pts[tg][i] -= 10; pts[maf.id][i] += 10; }
        }
      }
      T.filter(t => t.role === 'auditor' && ok(t.id) && q.mv[t.id] && by(q.mv[t.id])).forEach(a => { (r.audits[q.mv[a.id]] = r.audits[q.mv[a.id]] || []).push(a.id); });
      Object.entries(r.audits).forEach(([tid, auds]) => {
        if (q.aud[tid] === true) pts[tid][i] += 5;
        else if (q.aud[tid] === false) { pts[tid][i] -= 5; auds.forEach(a => { pts[a][i] += 5; }); }
      });
      return r;
    });
    return { pts, info, total: id => pts[id].reduce((a, b) => a + b, 0) };
  }

  function renderAdmin() {
    const w = h('<section class="wrap adm"></section>'); view.append(w);
    w.append(h('<div><div class="label">Для команды 8</div><h2 style="font-size:1.7rem;margin-top:4px">Панель ведущих</h2></div>'));
    const body = h('<div class="adm-body"></div>'); w.append(body);
    let pin = SS.get('k8_pin'), game = null, tab = SS.get('k8_tab') || 'game', saveT = null, stopped = false;
    if (pin) open(); else gate();

    function gate() {
      body.innerHTML = '';
      const f = h('<div class="sheet" style="display:grid;gap:14px;max-width:440px;margin:0"><label class="f">PIN ведущих<input id="admPin" type="password" inputmode="numeric" placeholder="PIN"></label><button type="button" class="btn" style="justify-self:start">Войти</button></div>');
      const inp = f.querySelector('input'), go = f.querySelector('button');
      const run = async () => { go.disabled = true; try { if (await DB().checkPin(inp.value)) { pin = inp.value; SS.set('k8_pin', pin); open(); } else { fail(new Error('Неверный PIN.')); go.disabled = false; } } catch (e) { fail(e); go.disabled = false; } };
      go.onclick = run; inp.onkeydown = e => { if (e.key === 'Enter') run(); };
      body.append(f); inp.focus();
    }
    async function open() {
      body.innerHTML = '<p class="g-muted">Загрузка…</p>';
      let d;
      try { d = await DB().adminLoad(pin); } catch (e) { SS.set('k8_pin', null); pin = null; fail(e); gate(); return; }
      game = d.game && d.game.teams ? d.game : blankGame();
      while (game.q.length < QN) game.q.push(blankQ());
      draw(d);
    }
    const save = () => {
      clearTimeout(saveT); const st = w.querySelector('#admSaved'); if (st) st.textContent = 'Сохраняем…';
      saveT = setTimeout(async () => { try { await DB().saveGame(pin, game); const s = w.querySelector('#admSaved'); if (s) s.textContent = 'Сохранено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch (e) { const s = w.querySelector('#admSaved'); if (s) s.textContent = 'Не сохранено: ' + e.message; } }, 350);
    };
    const changed = () => { save(); draw(); };

    function draw(loaded) {
      if (stopped) return;
      body.innerHTML = '';
      body.insertAdjacentHTML('beforeend', dbNote());
      const tabs = h('<div class="g-tabs" role="tablist"></div>');
      [['game', 'Ход игры'], ['screen', 'Экран'], ['results', 'Результаты']].forEach(([k, t]) => {
        const b = h('<button type="button" class="g-tab" role="tab" aria-selected="' + (tab === k) + '">' + t + '</button>');
        b.onclick = () => { tab = k; SS.set('k8_tab', k); draw(); }; tabs.append(b);
      });
      const top = h('<div class="adm-top"></div>'); top.append(tabs);
      top.append(h('<span class="adm-saved" id="admSaved"></span>'));
      const scr = h('<a class="btn ghost" href="#screen" target="_blank" rel="noopener">Открыть экран ↗</a>'); top.append(scr);
      const out = h('<button type="button" class="btn ghost">Выйти</button>'); out.onclick = () => { SS.set('k8_pin', null); pin = null; gate(); }; top.append(out);
      body.append(top);
      if (tab === 'game') drawGame(); else if (tab === 'screen') drawScreenCtl(); else drawResults(loaded);
    }

    /* ---------- экран ---------- */
    async function show(d) { try { await DB().setScreen(pin, d); scrState = d; if (tab === 'screen') draw(); } catch (e) { fail(e); } }
    let scrState = null;
    function drawScreenCtl() {
      const box = h('<div class="adm-grid"></div>'); body.append(box);
      const left = h('<div class="sheet adm-card"></div>'), right = h('<div class="sheet adm-card"></div>'); box.append(left, right);
      const cur = scrState || {};
      const it = itemOf(cur);
      right.append(h('<h3>Сейчас на экране</h3>'));
      right.append(h('<div class="reveal">' + (it ? '<div class="label">' + KIND[cur.kind] + (cur.label ? ' · ' + esc(cur.label) : '') + '</div><b>' + esc(it.text) + '</b>' + (cur.reveal ? '<br><span style="color:var(--green-2)">Ответ открыт</span>' : '') : 'Экран пустой.') + '</div>'));
      const row = h('<div class="adm-row"></div>');
      const rv = h('<button type="button" class="btn">' + (cur.reveal ? 'Скрыть ответ' : 'Показать ответ и разбор') + '</button>'); rv.disabled = !it; rv.onclick = () => show(Object.assign({}, cur, { reveal: !cur.reveal }));
      row.append(rv);
      [[60, '1 мин'], [120, '2 мин'], [180, '3 мин']].forEach(([s, t]) => { const b = h('<button type="button" class="btn ghost">⏱ ' + t + '</button>'); b.disabled = !it; b.onclick = () => show(Object.assign({}, cur, { ends: Date.now() + s * 1000 })); row.append(b); });
      const st = h('<button type="button" class="btn ghost">Стоп таймер</button>'); st.onclick = () => show(Object.assign({}, cur, { ends: 0 })); row.append(st);
      const cl = h('<button type="button" class="btn ghost" style="color:var(--bad)">Очистить экран</button>'); cl.onclick = () => show({}); row.append(cl);
      right.append(row);
      left.append(h('<h3>Что вывести</h3>'));
      [['main', 'Кейсы кварталов'], ['extra', 'Дополнительные кейсы'], ['oral', 'Устные вопросы Аудиторов']].forEach(([k, t]) => {
        const d = h('<details class="adm-bank"' + (k === 'main' ? ' open' : '') + '><summary>' + t + ' · ' + BANK()[k].length + '</summary><div class="adm-list"></div></details>');
        BANK()[k].forEach((q, i) => {
          const on = cur.kind === k && cur.idx === i;
          const r = h('<div class="adm-item' + (on ? ' on' : '') + '"><div><span class="label">' + esc(q.topic) + '</span><p>' + esc(q.text) + '</p><p class="adm-ans">' + (q.opts ? 'Ответ: ' + L[q.c] + ') ' + esc(q.opts[q.c]) : esc(q.answer)) + '</p></div></div>');
          const b = h('<button type="button" class="btn ' + (on ? '' : 'ghost') + '">' + (on ? 'На экране' : 'Показать') + '</button>');
          b.onclick = () => show({ kind: k, idx: i, reveal: false, ends: 0, label: cur.label || '' });
          r.append(b); d.querySelector('.adm-list').append(r);
        });
        left.append(d);
      });
    }
    DB().getScreen().then(d => { scrState = d || {}; if (tab === 'screen' && game) draw(); }).catch(() => { });

    /* ---------- ход игры (телефоны команд + секретная панель) ---------- */
    let gameStop = null;
    function drawGame() {
      if (gameStop) { gameStop(); gameStop = null; }
      const box = h('<div style="display:grid;gap:16px"></div>'); body.append(box);
      if (!window.K8G) { box.append(h('<p class="g-muted">Модуль игры не загрузился.</p>')); return; }
      gameStop = window.K8G.admin(box, pin, show, () => !stopped && tab === 'game' && box.isConnected, C);
    }
    function ynPair(val, set) {
      const yn = h('<div class="yn"></div>');
      [[true, '✓ Да'], [false, '✗ Нет']].forEach(([v, lab]) => { const b = h('<button type="button" class="ynb ' + (v ? 'y' : 'n') + '" aria-pressed="' + (val === v) + '">' + lab + '</button>'); b.onclick = () => set(val === v ? null : v); yn.append(b); });
      return yn;
    }

    /* ---------- результаты ---------- */
    async function drawResults(loaded) {
      const box = h('<div style="display:grid;gap:16px"></div>'); body.append(box);
      let d = loaded;
      if (!d || !d.results) { box.append(h('<p class="g-muted">Загрузка…</p>')); try { d = await DB().adminLoad(pin); } catch (e) { fail(e); return; } box.innerHTML = ''; }
      const rf = h('<button type="button" class="btn" style="justify-self:start">Обновить</button>'); rf.onclick = async () => { rf.disabled = true; try { const x = await DB().adminLoad(pin); draw(x); } catch (e) { fail(e); rf.disabled = false; } };
      box.append(rf);
      /* закрепление */
      const pr = (d.practice || []).slice(); const lp = LS.get(KP, null); if (lp && !pr.some(x => x.no === lp.no)) pr.push(Object.assign({ local: true }, lp));
      box.append(resTable('Работа на закрепление', pr, ['№', 'ФИО', 'Баллы'], r => [r.no, esc(r.name) + (r.local ? ' <span style="color:var(--warn)">· только на этом устройстве</span>' : ''), r.score + ' / 10'], r => [r.no, r.name, r.score].join(';'), 'practice'));
      /* exit-ticket */
      const ex = (d.results || []).map(r => Object.assign({}, r, { awaySec: r.away_sec != null ? r.away_sec : r.awaySec })); C.results().forEach(r => { if (!ex.some(x => x.no === r.no)) ex.push(Object.assign({ local: true }, r)); });
      box.append(resTable('Exit-ticket', ex, ['№', 'ФИО', 'Вар.', 'Баллы', 'Переходы', 'Код'], r => [r.no, esc(r.name) + (r.local ? ' <span style="color:var(--warn)">· только на этом устройстве</span>' : ''), r.v, r.score + '/' + r.max, r.leaves, '<span class="mono">' + esc(r.code) + '</span>'], r => [r.no, r.name, r.v, r.score, r.leaves, r.awaySec, r.code].join(';'), 'results'));
      /* проверка кода */
      const cf = h('<div class="sheet adm-card"><h3>Проверка кода Exit-ticket</h3><div class="fields"><label class="f">Код результата<input id="codeIn" placeholder="N12-V1-S18-P0-T14-XXXXX"></label></div><div class="reveal">Вставьте код со страницы результата.</div></div>');
      const co = cf.querySelector('.reveal');
      cf.querySelector('input').oninput = e => { const p = C.parseCode(e.target.value); if (!p) { co.textContent = 'Код не распознан.'; return; } const s = C.NAMES.find(x => x.no === p.no); co.innerHTML = (p.ok ? '<b style="color:var(--green-2)">Код подлинный.</b> ' : '<b style="color:var(--bad)">Код изменён или неверен.</b> ') + esc(s ? s.name : '№' + p.no) + ' · вариант ' + p.v + ' · ' + p.score + ' / ' + C.MAXPTS + ' · переходов: ' + p.leaves + ' · ' + p.mins + ' мин.'; };
      box.append(cf);
    }
    function resTable(title, rows, head, cells, csvRow, table) {
      rows.sort((a, b) => a.no - b.no);
      const card = h('<div class="sheet adm-card"><h3>' + title + ': ' + rows.length + ' из ' + C.NAMES.length + '</h3></div>');
      const left = C.NAMES.filter(s => !rows.some(r => r.no === s.no));
      if (rows.length && left.length) card.append(h('<p class="g-muted" style="font-size:.88rem">Ещё не сдали: ' + left.map(s => esc(s.name)).join(', ') + '</p>'));
      if (!rows.length) { card.append(h('<p class="g-muted">Пока никто не сдал.</p>')); return card; }
      const t = h('<div class="tbl"><table class="jt"><thead><tr>' + head.map(x => '<th>' + x + '</th>').join('') + '</tr></thead><tbody></tbody></table></div>');
      rows.forEach(r => t.querySelector('tbody').append(h('<tr>' + cells(r).map(c => '<td>' + c + '</td>').join('') + '</tr>')));
      const cp = h('<button type="button" class="btn ghost" style="justify-self:start">Скопировать для Excel</button>'); cp.onclick = () => copyText(cp, head.join(';') + '\n' + rows.map(csvRow).join('\n'), card);
      const cl = h('<button type="button" class="btn ghost" style="justify-self:start;color:var(--bad)">Очистить</button>');
      cl.onclick = () => dialog('<h3>Очистить «' + title + '»?</h3><p>Результаты всех студентов будут удалены' + (DB().online ? ' из общей базы' : ' с этого устройства') + '. Отменить нельзя — сначала скопируйте таблицу.</p>', [{ t: 'Отмена', cls: 'ghost' }, { t: 'Удалить', on: async () => { try { await DB().clear(pin, table); if (table === 'practice') { try { localStorage.removeItem(KP); } catch (e) { } } else C.clearLocalResults(); draw(await DB().adminLoad(pin)); } catch (e) { fail(e); } } }]);
      const row = h('<div class="adm-row"></div>'); row.append(cp, cl);
      card.append(t, row); return card;
    }
    return () => { stopped = true; clearTimeout(saveT); if (gameStop) gameStop(); };
  }

  return {
    render(id, ctx) {
      C = ctx; h = ctx.h; $ = ctx.$; view = ctx.view; dialog = ctx.dialog; view.innerHTML = '';
      if (id === 'practice') return renderPractice();
      if (id === 'screen') return renderScreen();
      return renderAdmin();
    },
    syncPending() { const m = LS.get(KP, null); if (m && !m.synced) syncPractice(m); },
    score
  };
})();
