/* «Налоговая мафия» с общей базой Supabase.
   #team / #team-КОД — телефон команды; K8G.admin(...) — вкладка «Ход игры» в панели ведущих.
   Правила: кейс квартала решают все команды; верный ответ = +10 и ход роли срабатывает.
   Схемщики выбирают жертву → днём доп. кейс (решила +5 / нет: −10, Схемщикам +10);
   Консультант защищает (+5 за спасение); Мимик +15, если Схемщики выбрали его;
   Аудиторы задают устный вопрос (ответили +5 / нет: −5, каждому Аудитору +5). */
window.K8G = (function () {
  "use strict";
  let C, h, dialog;
  const DB = () => window.K8DB, BANK = () => window.K8_CASES;
  const L = ['А', 'Б', 'В', 'Г'];
  const QN = 5;
  const ROLE = {
    mafia: { n: 'Схемщики', cls: 'r-mafia', verb: 'Жертва схемы', hint: 'Выберите команду, которой днём достанется дополнительный кейс. Если она его не решит — вам +10, ей −10.', goal: 'Набрать очки на чужих ошибках. Осторожно: среди команд прячется Мимик.' },
    consultant: { n: 'Консультант', cls: 'r-cons', verb: 'Защитить команду', hint: 'Если Схемщики выберут эту команду, схема сорвётся и вы получите +5. Себя можно, но не два квартала подряд.', goal: 'Угадать, кого выберут Схемщики, и сорвать схему.' },
    mimic: { n: 'Мимик', cls: 'r-mimic', verb: null, hint: 'Хода нет. Если Схемщики выберут вас — получите +15, а схема сгорит.', goal: 'Выглядеть удобной жертвой для Схемщиков.' },
    auditor: { n: 'Аудитор', cls: 'r-aud', verb: 'Задать вопрос команде', hint: 'Днём ведущий задаст этой команде устный вопрос. Не ответят — им −5, вам +5.', goal: 'Найти команды, которые плохо знают тему.' }
  };
  const PH = { setup: 'Формирование команд', case: 'Ночь: кейс квартала', day: 'День: доп. кейс и вопросы', done: 'Итоги квартала', end: 'Игра окончена' };
  const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
  const fail = e => dialog('<h3>Не получилось</h3><p>' + esc(e.message || e) + '</p>', [{ t: 'Понятно' }]);
  const time = t => t ? new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const fmt = n => (n > 0 ? '+' : '') + n;
  function rolesFor(n) { const r = ['mafia', 'consultant']; if (n >= 4) r.push('mimic'); while (r.length < n) r.push('auditor'); return r; }
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const newCode = used => { let c; do { c = Array.from({ length: 4 }, () => ABC[Math.floor(Math.random() * ABC.length)]).join(''); } while (used.includes(c)); return c; };
  const teamLink = code => location.origin + location.pathname + '#team-' + code;
  function timerTick(root, deadline) {
    const el = root.querySelector('[data-deadline]'); if (!el) return;
    const left = Math.max(0, Math.round((+el.dataset.deadline - Date.now()) / 1000));
    el.textContent = left ? String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0') : 'Время вышло';
    el.classList.toggle('out', left <= 10);
  }

  /* =================== ДВИЖОК ПОДСЧЁТА =================== */
  /* pub — открытое состояние, sec — секрет ведущих, moves — строки team_moves */
  function compute(pub, sec, moves) {
    const T = pub.teams || [], roles = sec.roles || {}, R = sec.rounds || [];
    const one = r => T.find(t => roles[t.id] === r);
    const total = {}; T.forEach(t => { total[t.id] = 0; });
    const rounds = [];
    for (let r = 1; r <= (pub.round || 0); r++) {
      const rs = R[r - 1] || {}, cs = BANK().main[rs.caseIdx];
      const mv = id => moves.find(m => m.round === r && m.team_id === id);
      const ok = {}, tgt = {};
      T.forEach(t => {
        const m = mv(t.id);
        const auto = m && m.answer != null && cs ? m.answer === cs.c : (m && m.answer != null ? false : null);
        ok[t.id] = rs.ov && rs.ov[t.id] != null ? rs.ov[t.id] : auto;
        tgt[t.id] = m && m.target ? m.target : null;
      });
      const pts = {}, why = {}; T.forEach(t => { pts[t.id] = 0; why[t.id] = []; });
      const add = (id, v, txt) => { if (!id || pts[id] == null) return; pts[id] += v; why[id].push(fmt(v) + ' · ' + txt); };
      T.forEach(t => { if (ok[t.id] === true) add(t.id, 10, 'верный ответ на кейс'); });
      const maf = one('mafia'), con = one('consultant'), mim = one('mimic');
      const name = id => { const t = T.find(x => x.id === id); return t ? '«' + t.name + '»' : '—'; };
      const prot = con && ok[con.id] === true ? tgt[con.id] : null;
      const info = { scheme: 'none', target: maf ? tgt[maf.id] : null, victim: null, audits: {}, extraOk: null };
      if (maf) {
        const t = tgt[maf.id];
        if (ok[maf.id] !== true || !t || !T.some(x => x.id === t)) info.scheme = ok[maf.id] === false ? 'wrong' : 'none';
        else if (mim && t === mim.id) { info.scheme = 'trap'; add(mim.id, 15, 'Схемщики попали в ловушку Мимика'); }
        else if (t === prot) { info.scheme = 'saved'; add(con.id, 5, 'спасли ' + name(t) + ' от схемы'); }
        else {
          info.scheme = 'victim'; info.victim = t;
          const vm = mv(t), ex = BANK().extra[rs.extraIdx != null ? rs.extraIdx : (r - 1) % BANK().extra.length];
          const auto = vm && vm.extra_answer != null ? vm.extra_answer === ex.c : null;
          info.extraOk = rs.extraOv != null ? rs.extraOv : auto;
          if (info.extraOk === true) add(t, 5, 'решили дополнительный кейс');
          else if (info.extraOk === false) { add(t, -10, 'не решили дополнительный кейс'); add(maf.id, 10, name(t) + ' не решила доп. кейс'); }
        }
      }
      T.filter(t => roles[t.id] === 'auditor' && ok[t.id] === true && tgt[t.id] && T.some(x => x.id === tgt[t.id])).forEach(a => { (info.audits[tgt[a.id]] = info.audits[tgt[a.id]] || []).push(a.id); });
      Object.entries(info.audits).forEach(([tid, auds]) => {
        const m = (rs.aud || {})[tid];
        if (m === true) add(tid, 5, 'ответили на вопрос Аудитора');
        else if (m === false) { add(tid, -5, 'не ответили на вопрос Аудитора'); auds.forEach(a => add(a, 5, name(tid) + ' не ответила на ваш вопрос')); }
      });
      T.forEach(t => { total[t.id] += pts[t.id]; });
      rounds.push({ r, rs, cs, ok, tgt, pts, why, info, mv });
    }
    return { rounds, total };
  }

  /* =================== ТЕЛЕФОН КОМАНДЫ =================== */
  const KT = 'k8_team_code';
  function renderTeam(id) {
    const w = h('<section class="wrap tm"></section>'); C.view.append(w);
    let code = id.startsWith('team-') ? id.slice(5).toUpperCase() : LS.get(KT, null);
    if (id.startsWith('team-')) { LS.set(KT, code); history.replaceState(null, '', '#team'); }
    if (!DB().online) { w.append(h('<div class="warnbox"><h3>Игра недоступна</h3><p>Общая база не подключена.</p></div>')); return null; }
    let pub = {}, me = null, stopW = null, poll = null, tick = null, key = '', showRole = false, stopped = false, joinStop = null;
    if (!code) askCode(); else start();

    function askCode() {
      w.innerHTML = '';
      let mode = 'reg', pubNow = {};
      const tabs = h('<div class="g-tabs" role="tablist"><button type="button" class="g-tab" data-m="reg">Зарегистрировать команду</button><button type="button" class="g-tab" data-m="code">Войти по коду</button></div>');
      const holder = h('<div></div>'); w.append(h('<div><div class="label">Налоговая мафия</div><h2 style="font-size:1.6rem;margin-top:4px">Команда</h2></div>'), tabs, holder);
      /* регистрация */
      const picked = new Set();
      const reg = h('<div class="sheet tm-join"><p class="g-muted">Один телефон на команду. Придумайте название и отметьте всех участников — себя в том числе. Роль команда получит сразу после регистрации.</p></div>');
      const nmIn = h('<label class="f">Название команды<input maxlength="40" placeholder="Например: ТОО «Дебет»"></label>');
      const search = h('<input class="search" type="search" placeholder="Поиск по фамилии">');
      const grid = h('<div class="namegrid g-names"></div>');
      const info = h('<div class="reveal">Отметьте участников.</div>');
      const go = h('<button type="button" class="btn" style="justify-self:start">Зарегистрировать и получить роль</button>');
      reg.append(nmIn, h('<div class="label">Участники из списка группы</div>'), search, grid, info, go);
      const drawGrid = () => {
        const taken = new Set((pubNow.teams || []).flatMap(t => t.members || []));
        [...picked].forEach(p => taken.has(p) && picked.delete(p));
        const q = search.value.trim().toLowerCase(); grid.innerHTML = '';
        C.NAMES.filter(x => x.name.toLowerCase().includes(q)).forEach(x => {
          const busy = taken.has(x.name), on = picked.has(x.name);
          const b = h('<button type="button" class="nm' + (busy ? ' done' : '') + '" aria-pressed="' + on + '"><span class="no">' + x.no + '.</span><span>' + esc(x.name) + (busy ? ' · уже в команде' : '') + '</span></button>');
          b.onclick = () => { if (busy) return; on ? picked.delete(x.name) : picked.add(x.name); drawGrid(); };
          grid.append(b);
        });
        const closed = pubNow.phase && pubNow.phase !== 'setup';
        info.innerHTML = closed ? '<b style="color:var(--bad)">Игра уже началась — регистрация закрыта.</b> Войдите по коду своей команды.' : picked.size ? 'Выбрано: <b>' + picked.size + '</b> — ' + [...picked].map(esc).join(', ') : 'Отметьте участников.';
        go.disabled = !!closed;
      };
      search.oninput = drawGrid;
      go.onclick = async () => {
        const name = nmIn.querySelector('input').value.trim();
        if (name.length < 2) return fail(new Error('Введите название команды.'));
        if (!picked.size) return fail(new Error('Отметьте участников команды.'));
        go.disabled = true;
        try {
          const r = await DB().teamRegister(name, [...picked]);
          code = r.code; LS.set(KT, code); stopJoin(); showRole = true;
          dialog('<h3>Команда «' + esc(name) + '» зарегистрирована</h3><p>Код вашей команды: <b class="g-code">' + esc(code) + '</b></p><p class="g-muted">Запомните его: по коду можно войти с другого телефона. Роль показана на экране — не показывайте её другим командам.</p>', [{ t: 'Понятно' }]);
          start();
        } catch (e) { fail(e); go.disabled = false; }
      };
      /* вход по коду */
      const enter = h('<div class="sheet tm-join"><p class="g-muted">Код из 4 символов показан на телефоне, с которого команда регистрировалась.</p><label class="f">Код команды<input class="g-codein" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="K7P2"></label><button type="button" class="btn" style="justify-self:start">Войти</button></div>');
      const inp = enter.querySelector('input');
      const goCode = () => { const v = inp.value.trim().toUpperCase(); if (v.length < 4) return; code = v; LS.set(KT, v); stopJoin(); start(); };
      enter.querySelector('button').onclick = goCode; inp.onkeydown = e => { if (e.key === 'Enter') goCode(); };
      const show = m => { mode = m; tabs.querySelectorAll('.g-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.m === m))); holder.innerHTML = ''; holder.append(m === 'reg' ? reg : enter); };
      tabs.querySelectorAll('.g-tab').forEach(b => { b.onclick = () => show(b.dataset.m); });
      const upd = g => { pubNow = g || {}; drawGrid(); if (pubNow.phase && pubNow.phase !== 'setup' && mode === 'reg') show('code'); };
      DB().gameGet().then(upd).catch(() => { });
      const offW = DB().watchGame(upd), pl = setInterval(() => DB().gameGet().then(upd).catch(() => { }), 5000);
      function stopJoin() { offW(); clearInterval(pl); }
      joinStop = stopJoin;
      show('reg'); drawGrid();
    }
    async function load() {
      try { const [g, v] = await Promise.all([DB().gameGet(), DB().teamView(code)]); pub = g || {}; me = v; draw(); }
      catch (e) { if (/не найдена/.test(e.message)) { LS.set(KT, null); code = null; stop(); askCode(); fail(e); } }
    }
    function start() {
      w.innerHTML = '<p class="g-muted">Загрузка…</p>';
      load(); stopW = DB().watchGame(g => { pub = g || {}; load(); });
      poll = setInterval(load, 6000); tick = setInterval(() => timerTick(w), 500);
    }
    function stop() { stopW && stopW(); clearInterval(poll); clearInterval(tick); }

    function draw() {
      if (stopped || !me) return;
      const T = pub.teams || [], my = T.find(t => t.id === me.id) || { name: '…', members: [] };
      const r = pub.round || 0, phase = pub.phase || 'setup';
      const isVictim = phase === 'day' && pub.day && pub.day.victim === me.id;
      const mv = me.move || {};
      const k = [phase, r, isVictim, mv.updated_at || '', me.role, (me.notes || []).length, T.length, (pub.day && (pub.day.audited || []).join()) || ''].join('|');
      if (k === key) return; key = k;
      const focus = document.activeElement && w.contains(document.activeElement) && /TEXTAREA|INPUT/.test(document.activeElement.tagName);
      if (focus && phase === 'case' && w.querySelector('.tm-form')) { const st = w.querySelector('.tm-sent'); if (st) st.innerHTML = sentLine(mv); return; }
      w.innerHTML = '';
      const R = ROLE[me.role] || { n: 'роль ещё не выдана', cls: '' };
      const top = h('<div class="tm-top"><div><div class="label">' + (r ? 'Квартал ' + r + ' из ' + (pub.maxRounds || QN) + ' · ' : '') + (PH[phase] || '') + '</div><h2>' + esc(my.name) + '</h2><p class="g-muted" style="font-size:.88rem">' + (my.members || []).map(esc).join(', ') + '</p></div>' + (pub.deadline && phase === 'case' ? '<span class="g-timer" data-deadline="' + pub.deadline + '">--:--</span>' : '') + '</div>');
      w.append(top);
      w.append(h('<div class="g-coderow"><span>Код команды: <b class="g-code">' + esc(code) + '</b></span><span class="g-muted" style="font-size:.85rem">по нему можно войти с другого телефона</span></div>'));
      const rb = h('<button type="button" class="btn ghost tm-rolebtn">' + (showRole ? 'Скрыть роль' : 'Показать нашу роль (тайно)') + '</button>');
      rb.onclick = () => { showRole = !showRole; key = ''; draw(); };
      w.append(rb);
      if (showRole) w.append(h('<div class="rolecard2 ' + R.cls + '"><div class="label">Ваша роль</div><h3>' + R.n + '</h3><p>' + esc(R.goal || '') + '</p><p class="g-muted">' + esc(R.hint || '') + '</p></div>'));

      if (phase === 'setup') w.append(h('<div class="reveal">Команда создана. Ведущий скоро начнёт первый квартал — кейс появится на доске и здесь.</div>'));
      else if (phase === 'case') caseForm(r, mv, T);
      else if (phase === 'day') {
        if (isVictim) extraForm(r, mv);
        else if (pub.day && (pub.day.audited || []).includes(me.id)) w.append(h('<div class="ev hit"><b>Аудитор выбрал вашу команду.</b> Ведущий задаст вам устный вопрос — приготовьтесь объяснить норму НК.</div>'));
        else w.append(h('<div class="reveal">День. Следите за доской: жертва схемы решает дополнительный кейс, Аудиторы задают вопросы.</div>'));
        if (mv.answer != null) w.append(h('<p class="g-muted">Ваш ответ на кейс квартала: <b>' + L[mv.answer] + '</b>.</p>'));
      } else if (phase === 'done') w.append(h('<div class="reveal">Квартал ' + r + ' закрыт. Ждём следующий кейс.</div>'));
      else if (phase === 'end') {
        w.append(h('<div class="g-win honest"><div class="label" style="color:inherit;opacity:.8">Игра окончена</div><h3>Итоговая таблица</h3></div>'));
        const t = h('<div class="tbl"><table class="sm"><thead><tr><th>#</th><th>Команда</th><th>Роль</th><th class="n-right">Очки</th></tr></thead><tbody></tbody></table></div>');
        (pub.final || []).forEach((x, i) => t.querySelector('tbody').append(h('<tr' + (x.id === me.id ? ' style="background:var(--green-soft)"' : '') + '><td>' + (i + 1) + '</td><td><b>' + esc(x.name) + '</b></td><td>' + esc(ROLE[x.role] ? ROLE[x.role].n : '') + '</td><td class="n-right"><b>' + x.total + '</b></td></tr>')));
        w.append(t);
      }
      const notes = me.notes || [];
      if (notes.length) {
        const n = h('<details class="sheet tm-notes"' + (phase === 'done' ? ' open' : '') + '><summary><b>Наши итоги по кварталам</b></summary></details>');
        notes.slice().reverse().forEach(x => n.append(h('<div class="tm-note"><b>Квартал ' + x.round + ': ' + fmt(x.pts) + '</b>' + (x.lines.length ? '<ul>' + x.lines.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>' : '<p class="g-muted">без изменений</p>') + '</div>')));
        w.append(n);
      }
      const out = h('<button type="button" class="btn ghost" style="justify-self:start;font-size:.85rem">Выйти на этом телефоне</button>');
      out.onclick = () => dialog('<h3>Выйти?</h3><p>Вернуться можно по коду команды.</p>', [{ t: 'Отмена', cls: 'ghost' }, { t: 'Выйти', on: () => { LS.set(KT, null); stop(); code = null; askCode(); } }]);
      w.append(out);
      timerTick(w);
    }
    function sentLine(mv) { return mv && mv.answer != null ? '✓ Отправлено в ' + time(mv.updated_at) + '. Можно изменить, пока идёт ночь.' : 'Ответ ещё не отправлен.'; }
    function caseForm(r, mv, T) {
      const cs = BANK().main[pub.caseIdx]; if (!cs) return;
      const dk = 'k8_draft_' + r;
      const draft = LS.get(dk, null) || { a: mv.answer != null ? mv.answer : null, arg: mv.arg || '', t: mv.target || '' };
      const f = h('<div class="sheet tm-form"></div>');
      f.append(h('<div class="label">' + esc(cs.topic) + ' · кейс на доске</div>'), h('<h3 class="tm-q">' + esc(cs.text) + '</h3>'));
      const opts = h('<div class="pr-opts"></div>');
      cs.opts.forEach((o, j) => { const b = h('<button type="button" class="pr-opt" aria-pressed="' + (draft.a === j) + '"><span class="L">' + L[j] + '</span><span>' + esc(o) + '</span></button>'); b.onclick = () => { draft.a = j; LS.set(dk, draft); opts.querySelectorAll('.pr-opt').forEach((x, k) => x.setAttribute('aria-pressed', String(k === j))); }; opts.append(b); });
      f.append(h('<div class="label">1. Ответ</div>'), opts);
      const ta = h('<label class="f">2. Аргументация: почему этот ответ, какая норма НК РК<textarea rows="4" maxlength="1500" placeholder="Например: по п. 5 ст. 115 НК отчётность считается представленной только со статусом «Документ принят»…"></textarea></label>');
      const tx = ta.querySelector('textarea'); tx.value = draft.arg; tx.oninput = () => { draft.arg = tx.value; LS.set(dk, draft); };
      f.append(ta);
      const R = ROLE[me.role];
      if (R && R.verb) {
        const opt = T.filter(t => t.id !== me.id || me.role === 'consultant');
        const s = h('<label class="f">3. Тайный ход — ' + R.verb.toLowerCase() + '<select><option value="">— выберите команду —</option>' + opt.map(t => '<option value="' + t.id + '"' + (draft.t === t.id ? ' selected' : '') + (me.role === 'consultant' && t.id === me.prevTarget ? ' disabled' : '') + '>' + esc(t.name) + (t.id === me.id ? ' (мы)' : '') + (me.role === 'consultant' && t.id === me.prevTarget ? ' — защищали прошлый квартал' : '') + '</option>').join('') + '</select></label>');
        s.querySelector('select').onchange = e => { draft.t = e.target.value; LS.set(dk, draft); };
        f.append(s, h('<p class="g-muted" style="font-size:.86rem">' + esc(R.hint) + ' Ход сработает, только если ответ на кейс верный.</p>'));
      } else if (R) f.append(h('<p class="g-muted" style="font-size:.9rem">3. Тайного хода у вашей роли нет. ' + esc(R.hint) + '</p>'));
      const st = h('<p class="tm-sent g-muted">' + sentLine(mv) + '</p>');
      const b = h('<button type="button" class="btn blue g-send">' + (mv.answer != null ? 'Изменить ответ' : 'Отправить ответ') + '</button>');
      b.onclick = async () => {
        if (draft.a == null) return fail(new Error('Выберите вариант ответа.'));
        if ((draft.arg || '').trim().length < 10) return fail(new Error('Напишите аргументацию — хотя бы одно предложение со ссылкой на норму.'));
        if (R && R.verb && !draft.t) return fail(new Error('Выберите команду для тайного хода.'));
        b.disabled = true;
        try { await DB().teamSubmit(code, r, draft.a, draft.arg.trim(), R && R.verb ? draft.t : ''); key = ''; await load(); }
        catch (e) { fail(e); b.disabled = false; }
      };
      f.append(st, b); w.append(f);
    }
    function extraForm(r, mv) {
      const ex = BANK().extra[pub.day.extraIdx]; if (!ex) return;
      const f = h('<div class="sheet tm-form tm-extra"></div>');
      f.append(h('<div class="ev hit"><b>Схемщики выбрали вашу команду.</b> Решите дополнительный кейс: верно — +5, неверно — −10. Одна попытка.</div>'));
      f.append(h('<div class="label">' + esc(ex.topic) + '</div>'), h('<h3 class="tm-q">' + esc(ex.text) + '</h3>'));
      if (mv.extra_answer != null) { f.append(h('<div class="reveal">Ответ отправлен: <b>' + L[mv.extra_answer] + ') ' + esc(ex.opts[mv.extra_answer]) + '</b>. Итог объявит ведущий.</div>')); w.append(f); return; }
      let a = null;
      const opts = h('<div class="pr-opts"></div>');
      ex.opts.forEach((o, j) => { const b = h('<button type="button" class="pr-opt" aria-pressed="false"><span class="L">' + L[j] + '</span><span>' + esc(o) + '</span></button>'); b.onclick = () => { a = j; opts.querySelectorAll('.pr-opt').forEach((x, k) => x.setAttribute('aria-pressed', String(k === j))); }; opts.append(b); });
      const ta = h('<label class="f">Аргументация<textarea rows="3" maxlength="1500" placeholder="Почему этот ответ, какая норма"></textarea></label>');
      const b = h('<button type="button" class="btn blue g-send">Отправить ответ на доп. кейс</button>');
      b.onclick = () => {
        if (a == null) return fail(new Error('Выберите вариант ответа.'));
        dialog('<h3>Отправить ответ «' + L[a] + '»?</h3><p>Изменить его будет нельзя.</p>', [{ t: 'Отмена', cls: 'ghost' }, { t: 'Отправить', on: async () => { try { await DB().teamExtra(code, r, a, ta.querySelector('textarea').value.trim()); key = ''; await load(); } catch (e) { fail(e); } } }]);
      };
      f.append(opts, ta, b); w.append(f);
    }
    return () => { stopped = true; stop(); joinStop && joinStop(); };
  }

  /* =================== ПАНЕЛЬ ВЕДУЩИХ: ХОД ИГРЫ =================== */
  /* box — контейнер вкладки; pin; show(d) — вывод на экран; isActive() — вкладка открыта */
  function admin(box, pin, show, isActive) {
    let pub = null, sec = null, moves = [], sig = '', poll = null, showRoles = true, qSel = {}, deleted = new Set(), poolTouched = false;
    const nm = id => { const t = (pub.teams || []).find(x => x.id === id); return t ? t.name : '—'; };
    async function load(force) {
      if (!isActive()) { clearInterval(poll); return; }
      try {
        const d = await DB().adminGame(pin);
        const s = JSON.stringify(d); if (s === sig && !force) return; sig = s;
        pub = Object.assign({ phase: 'setup', round: 0, maxRounds: QN, teams: [] }, d.game || {});
        sec = Object.assign({ roles: {}, codes: {}, pool: [], planned: 7, rounds: [], notes: {} }, d.secret && d.secret.codes ? d.secret : {});
        moves = d.moves || [];
        const ae = document.activeElement; if (!force && ae && box.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
        draw();
      } catch (e) { box.innerHTML = ''; box.append(h('<div class="warnbox"><h3>Нет связи с игрой</h3><p>' + esc(e.message) + '</p></div>')); }
    }
    /* перед записью подтягиваем команды, которые зарегистрировались, пока ведущий работал */
    async function save() {
      try {
        const d = await DB().adminGame(pin), g = d.game || {}, s = d.secret && d.secret.codes ? d.secret : {};
        (g.teams || []).forEach(t => { if (!pub.teams.some(x => x.id === t.id) && !deleted.has(t.id)) { pub.teams.push(t); sec.roles[t.id] = (s.roles || {})[t.id]; sec.codes[t.id] = (s.codes || {})[t.id]; } });
        if (!poolTouched && Array.isArray(s.pool)) sec.pool = s.pool;
        poolTouched = false; deleted = new Set();
        await DB().adminGameSet(pin, pub, sec); sig = ''; await load(true);
      } catch (e) { fail(e); }
    }
    if (!DB().online) { box.append(h('<div class="warnbox"><h3>Нужна общая база</h3><p>Игра с телефонами команд работает только с Supabase.</p></div>')); return; }
    box.append(h('<p class="g-muted">Загрузка игры…</p>'));
    load(true); poll = setInterval(load, 3000);

    function draw() {
      box.innerHTML = '';
      const T = pub.teams, S = compute(pub, sec, moves), r = pub.round, cur = S.rounds[r - 1];
      /* статус */
      const answered = cur ? T.filter(t => { const m = cur.mv(t.id); return m && m.answer != null; }).length : 0;
      const st = h('<div class="gm-status"><div><span class="label">Фаза</span><b>' + (PH[pub.phase] || '') + '</b></div><div><span class="label">Квартал</span><b>' + (r || '—') + ' / ' + pub.maxRounds + '</b></div><div><span class="label">Команд</span><b>' + T.length + '</b></div><div><span class="label">' + (pub.phase === 'case' ? 'Ответили' : 'Обновлено') + '</span><b>' + (pub.phase === 'case' ? answered + ' / ' + T.length : time(Date.now())) + '</b></div></div>');
      box.append(st);
      const rr = h('<label class="gm-secret"><input type="checkbox"' + (showRoles ? ' checked' : '') + '> Показывать роли (не выводите эту вкладку на проектор)</label>');
      rr.querySelector('input').onchange = e => { showRoles = e.target.checked; draw(); };
      box.append(rr);
      const role = id => { const ro = sec.roles[id]; return ro ? '<span class="rchip ' + ROLE[ro].cls + (showRoles ? '' : ' blur') + '">' + ROLE[ro].n + '</span>' : '<span class="g-muted">—</span>'; };

      if (pub.phase === 'setup') drawSetup(T, role);
      else { drawControl(T, S, cur, role); }
      if (pub.phase !== 'setup') drawTeams(T, role, false);
      if (S.rounds.length) drawScore(T, S, role);
      if (S.rounds.length) drawHistory(T, S, role);
      drawDanger();
    }

    /* --- регистрация команд (команды регистрируются сами с телефонов) --- */
    function drawSetup(T, role) {
      const card = h('<div class="sheet adm-card"><h3>1. Сколько будет команд</h3><p class="g-muted" style="font-size:.9rem">По этому числу заранее перемешиваются роли: 1 Схемщики, 1 Консультант, 1 Мимик (при 4+), остальные — Аудиторы. Каждая зарегистрированная команда сразу получает роль из этого набора. Число можно менять, пока нет ни одной команды.</p></div>');
      const s = h('<select style="max-width:200px"' + (T.length ? ' disabled' : '') + '>' + [3, 4, 5, 6, 7, 8, 9, 10].map(n => '<option' + (n === sec.planned ? ' selected' : '') + '>' + n + '</option>').join('') + '</select>');
      s.onchange = () => { sec.planned = +s.value; sec.pool = shuffle(rolesFor(sec.planned)); poolTouched = true; save(); };
      card.append(s);
      box.append(card);
      const link = location.origin + location.pathname + '#team';
      const reg = h('<div class="sheet adm-card"><h3>2. Регистрация команд — ' + T.length + ' из ' + sec.planned + '</h3><p>Капитан открывает ссылку на телефоне, вводит название команды и отмечает участников из списка группы. Роль и код команда получает сразу.</p><p class="g-code" style="font-size:1rem;letter-spacing:0;word-break:break-all;justify-self:start">' + esc(link) + '</p></div>');
      const row = h('<div class="adm-row"></div>');
      const sb = h('<button type="button" class="btn">Ссылку и QR на доску</button>'); sb.onclick = () => show({ kind: 'join', url: link });
      const left = C.NAMES.filter(x => !T.some(t => (t.members || []).includes(x.name)));
      row.append(sb); reg.append(row);
      reg.append(h('<p class="g-muted" style="font-size:.88rem">Ещё не в команде (' + left.length + '): ' + left.map(x => esc(x.name)).join(', ') + '</p>'));
      box.append(reg);
      drawTeams(T, role, true);
      if (T.length >= 3) {
        const c = h('<div class="sheet adm-card"><h3>3. Старт</h3><p>Когда все команды зарегистрировались — начинайте первый квартал. После старта регистрация закроется.</p></div>');
        const rr = h('<button type="button" class="btn ghost" style="justify-self:start">Перераздать роли случайно</button>');
        rr.onclick = () => dialog('<h3>Перераздать роли?</h3><p>Роли всех команд поменяются по правилу распределения. Команды увидят новую роль на телефоне.</p>', [{ t: 'Отмена', cls: 'ghost' }, { t: 'Перераздать', on: () => { const p = shuffle(rolesFor(T.length)); T.forEach((t, i) => { sec.roles[t.id] = p[i]; }); sec.pool = []; poolTouched = true; save(); } }]);
        c.append(rr, quarterStart(1));
        box.append(c);
      } else box.append(h('<div class="reveal">Для старта нужно минимум 3 команды.</div>'));
    }
    /* выбор кейса и старт квартала */
    function quarterStart(n) {
      const used = (sec.rounds || []).map(x => x.caseIdx);
      const def = BANK().main.findIndex((c, i) => !used.includes(i) && c.topic.startsWith('Тема ' + n));
      if (qSel[n] == null) qSel[n] = def >= 0 ? def : BANK().main.findIndex((c, i) => !used.includes(i));
      const wrap = h('<div class="adm-row" style="margin-top:6px"></div>');
      const s = h('<select style="flex:2 1 320px">' + BANK().main.map((c, i) => '<option value="' + i + '"' + (i === qSel[n] ? ' selected' : '') + '>' + (used.includes(i) ? '✓ ' : '') + (i + 1) + '. ' + esc(c.topic) + ' — ' + esc(c.text.slice(0, 60)) + '…</option>').join('') + '</select>');
      s.onchange = () => { qSel[n] = +s.value; };
      const tm = h('<select style="flex:0 1 140px"><option value="120">2 мин</option><option value="180">3 мин</option><option value="90">1,5 мин</option><option value="0">без таймера</option></select>');
      const b = h('<button type="button" class="btn blue">Начать квартал ' + n + ': кейс на доску</button>');
      b.onclick = async () => {
        const ci = qSel[n], secs = +tm.value;
        pub.round = n; pub.phase = 'case'; pub.caseIdx = ci; pub.deadline = secs ? Date.now() + secs * 1000 : 0; pub.day = null;
        sec.rounds[n - 1] = { caseIdx: ci, ov: {}, aud: {}, extraOv: null, extraIdx: (n - 1) % BANK().extra.length, victim: null };
        await save(); show({ kind: 'main', idx: ci, reveal: false, ends: pub.deadline, label: 'Квартал ' + n + ' · кейс для всех команд' });
      };
      wrap.append(s, tm, b); return wrap;
    }

    /* --- управление кварталом --- */
    function drawControl(T, S, cur, role) {
      const r = pub.round, card = h('<div class="sheet adm-card"></div>');
      if (pub.phase === 'case') {
        const cs = BANK().main[pub.caseIdx];
        card.append(h('<h3>Квартал ' + r + ' · ночь</h3>'), h('<p><b>Кейс:</b> ' + esc(cs.text) + ' <span class="adm-ans">Верно: ' + L[cs.c] + ') ' + esc(cs.opts[cs.c]) + ' · ' + esc(cs.ref) + '</span></p>'));
        const row = h('<div class="adm-row"></div>');
        const rv = h('<button type="button" class="btn ghost">Кейс на доску ещё раз</button>'); rv.onclick = () => show({ kind: 'main', idx: pub.caseIdx, reveal: false, ends: pub.deadline, label: 'Квартал ' + r + ' · кейс для всех команд' });
        const nx = h('<button type="button" class="btn">Закончить ночь → день</button>');
        nx.onclick = () => dialog('<h3>Закончить ночь?</h3><p>Команды больше не смогут менять ответы. Ответили: ' + T.filter(t => { const m = cur.mv(t.id); return m && m.answer != null; }).length + ' из ' + T.length + '.</p>', [{ t: 'Отмена', cls: 'ghost' }, { t: 'Закончить ночь', on: closeNight }]);
        row.append(rv, nx); card.append(row);
        box.append(card);
        box.append(roundTable(T, cur, role, true));
        return;
      }
      if (pub.phase === 'day') {
        card.append(h('<h3>Квартал ' + r + ' · день</h3>'));
        const row = h('<div class="adm-row"></div>');
        const ans = h('<button type="button" class="btn ghost">Ответ кейса на доску</button>'); ans.onclick = () => show({ kind: 'main', idx: pub.caseIdx, reveal: true, ends: 0, label: 'Квартал ' + r + ' · разбор' });
        row.append(ans); card.append(row);
        card.append(eventsBlock(T, cur));
        const cl = h('<button type="button" class="btn">Закрыть квартал ' + r + ' и начислить очки</button>');
        cl.onclick = () => {
          const pend = (cur.info.victim && cur.info.extraOk == null ? 1 : 0) + Object.keys(cur.info.audits).filter(t => (cur.rs.aud || {})[t] == null).length;
          dialog('<h3>Закрыть квартал?</h3>' + (pend ? '<p style="color:var(--bad)">Не оценено: ' + pend + ' (будет 0 очков по ним).</p>' : '') + '<p>Командам придут их итоги квартала.</p>', [{ t: 'Отмена', cls: 'ghost' }, { t: 'Закрыть', on: closeQuarter }]);
        };
        card.append(cl);
        box.append(card);
        box.append(roundTable(T, cur, role, false));
        return;
      }
      if (pub.phase === 'done') {
        card.append(h('<h3>Квартал ' + r + ' закрыт</h3>'), quarterSummary(T, cur));
        if (r < pub.maxRounds) card.append(quarterStart(r + 1));
        const end = h('<button type="button" class="btn ghost" style="justify-self:start">' + (r < pub.maxRounds ? 'Завершить игру досрочно' : 'Завершить игру и показать итоги') + '</button>');
        end.onclick = endGame; card.append(end);
        box.append(card); return;
      }
      if (pub.phase === 'end') {
        card.append(h('<h3>Игра окончена</h3>'));
        const row = h('<div class="adm-row"></div>');
        const sc = h('<button type="button" class="btn">Итоги на доску</button>'); sc.onclick = () => show({ kind: 'scores', rows: pub.final || [] });
        const cp = h('<button type="button" class="btn ghost">Скопировать результаты по ученикам (Excel)</button>');
        cp.onclick = () => {
          const S2 = compute(pub, sec, moves);
          const rows = ['ФИО;Команда;Роль;Очки команды;Верных ответов из ' + pub.round].concat(T.flatMap(t => (t.members || []).map(m => [m, t.name, ROLE[sec.roles[t.id]].n, S2.total[t.id], S2.rounds.filter(x => x.ok[t.id] === true).length].join(';'))));
          const text = rows.join('\n');
          try { navigator.clipboard.writeText(text).then(() => { cp.textContent = 'Скопировано'; }, () => fallback()); } catch (e) { fallback(); }
          function fallback() { const ta = h('<textarea style="width:100%;min-height:140px"></textarea>'); ta.value = text; card.append(ta); ta.select(); }
        };
        row.append(sc, cp); card.append(row);
        box.append(card);
      }
    }
    function roundTable(T, cur, role, live) {
      const cs = cur.cs;
      const t = h('<div class="tbl"><table class="sm gm-t"><thead><tr><th>Команда</th><th>Ответ</th><th>Аргументация</th><th>Тайный ход</th><th>Оценка ответа</th></tr></thead><tbody></tbody></table></div>');
      T.forEach(tm => {
        const m = cur.mv(tm.id) || {}, ro = sec.roles[tm.id], ok = cur.ok[tm.id], ov = (cur.rs.ov || {})[tm.id];
        const tr = h('<tr><td><b>' + esc(tm.name) + '</b><br>' + role(tm.id) + '</td>' +
          '<td>' + (m.answer != null ? '<b class="gm-ans ' + (m.answer === cs.c ? 'y' : 'n') + '">' + L[m.answer] + '</b><br><span class="g-muted" style="font-size:.78rem">' + time(m.updated_at) + '</span>' : '<span class="g-muted">' + (live ? 'ждём…' : 'нет ответа') + '</span>') + '</td>' +
          '<td class="gm-arg">' + (m.arg ? esc(m.arg) : '<span class="g-muted">—</span>') + '</td>' +
          '<td>' + (ROLE[ro] && ROLE[ro].verb ? (m.target ? '<span class="g-muted" style="font-size:.8rem">' + ROLE[ro].verb + '</span><br><b>' + esc(nm(m.target)) + '</b>' + (ok === false ? '<div class="mv-off">ход сгорел — ответ неверный</div>' : '') : '<span class="g-muted">не выбран</span>') : '<span class="g-muted">хода нет</span>') + '</td><td></td></tr>');
        const yn = h('<div class="yn"></div>');
        [[true, '✓'], [false, '✗']].forEach(([v, lab]) => { const b = h('<button type="button" class="ynb ' + (v ? 'y' : 'n') + '" aria-pressed="' + (ok === v) + '" title="' + (v ? 'Засчитать' : 'Не засчитать') + '">' + lab + '</button>'); b.onclick = () => { cur.rs.ov = cur.rs.ov || {}; if (ov === v) delete cur.rs.ov[tm.id]; else cur.rs.ov[tm.id] = v; syncDay(); save(); }; yn.append(b); });
        tr.lastChild.append(yn, h('<div class="g-muted" style="font-size:.75rem">' + (ov != null ? 'исправлено вручную' : 'авто по ответу') + '</div>'));
        t.querySelector('tbody').append(tr);
      });
      return t;
    }
    function eventsBlock(T, cur) {
      const i = cur.info, wrap = h('<div style="display:grid;gap:10px"></div>');
      const txt = { none: 'Схемщики не сделали ход (нет ответа или не выбрана жертва).', wrong: 'Схемщики ошиблись в кейсе — схема не сработала.', trap: 'Схемщики выбрали Мимика «' + esc(nm(i.target)) + '»: Мимику +15, схема сгорела.', saved: 'Консультант защитил «' + esc(nm(i.target)) + '»: схема сорвана, Консультанту +5.', victim: 'Жертва схемы — «' + esc(nm(i.victim)) + '». Она решает дополнительный кейс на своём телефоне.' }[i.scheme];
      wrap.append(h('<div class="ev ' + (i.scheme === 'victim' ? 'hit' : i.scheme === 'trap' || i.scheme === 'saved' ? 'good' : '') + '">' + txt + '</div>'));
      if (i.victim) {
        const ex = BANK().extra[cur.rs.extraIdx], vm = cur.mv(i.victim) || {};
        const c = h('<div class="gm-extra"><div><span class="label">Доп. кейс · ' + esc(ex.topic) + '</span><p>' + esc(ex.text) + ' <span class="adm-ans">Верно: ' + L[ex.c] + ') ' + esc(ex.opts[ex.c]) + '</span></p>' +
          (vm.extra_answer != null ? '<p>Ответ команды: <b class="gm-ans ' + (vm.extra_answer === ex.c ? 'y' : 'n') + '">' + L[vm.extra_answer] + '</b> · ' + time(vm.updated_at) + '</p><p class="gm-arg">' + esc(vm.extra_arg || '—') + '</p>' : '<p class="g-muted">Ждём ответ команды…</p>') + '</div></div>');
        const row = h('<div class="adm-row"></div>');
        const sb = h('<button type="button" class="btn ghost">Доп. кейс на доску</button>'); sb.onclick = () => show({ kind: 'extra', idx: cur.rs.extraIdx, reveal: false, ends: Date.now() + 60000, label: 'Доп. кейс для «' + nm(i.victim) + '»' });
        const sa = h('<button type="button" class="btn ghost">Ответ доп. кейса на доску</button>'); sa.onclick = () => show({ kind: 'extra', idx: cur.rs.extraIdx, reveal: true, ends: 0, label: 'Доп. кейс для «' + nm(i.victim) + '»' });
        row.append(h('<span>Итог:</span>'), yn(i.extraOk, cur.rs.extraOv != null, v => { cur.rs.extraOv = v; save(); }), sb, sa);
        c.append(row); wrap.append(c);
      }
      const au = Object.entries(i.audits);
      wrap.append(h('<h4 style="margin:6px 0 0">Вопросы Аудиторов: ' + au.length + '</h4>'));
      if (!au.length) wrap.append(h('<p class="g-muted">Нет вопросов (Аудиторы ошиблись или не выбрали команду).</p>'));
      au.forEach(([tid, auds], k) => {
        const oi = ((pub.round - 1) * 2 + k) % BANK().oral.length, q = BANK().oral[oi];
        const c = h('<div class="gm-extra"><div><span class="label">Вопрос для «' + esc(nm(tid)) + '» · от ' + auds.map(a => esc(nm(a))).join(', ') + '</span><p>' + esc(q.text) + '</p><p class="adm-ans">Ответ: ' + esc(q.answer) + '</p></div></div>');
        const row = h('<div class="adm-row"></div>');
        const sb = h('<button type="button" class="btn ghost">Вопрос на доску</button>'); sb.onclick = () => show({ kind: 'oral', idx: oi, reveal: false, ends: 0, label: 'Вопрос для «' + nm(tid) + '»' });
        row.append(h('<span>Ответили?</span>'), yn((cur.rs.aud || {})[tid], true, v => { cur.rs.aud = cur.rs.aud || {}; if (v == null) delete cur.rs.aud[tid]; else cur.rs.aud[tid] = v; save(); }), sb);
        c.append(row); wrap.append(c);
      });
      return wrap;
    }
    function yn(val, manual, set) {
      const d = h('<div class="yn"></div>');
      [[true, '✓ Да'], [false, '✗ Нет']].forEach(([v, lab]) => { const b = h('<button type="button" class="ynb ' + (v ? 'y' : 'n') + '" aria-pressed="' + (val === v) + '">' + lab + '</button>'); b.onclick = () => set(val === v && manual ? null : v); d.append(b); });
      return d;
    }
    function syncDay() {
      if (pub.phase !== 'day') return;
      const S = compute(pub, sec, moves), cur = S.rounds[pub.round - 1];
      cur.rs.victim = cur.info.victim;
      pub.day = { victim: cur.info.victim, extraIdx: cur.rs.extraIdx, audited: Object.keys(cur.info.audits) };
    }
    async function closeNight() { pub.phase = 'day'; pub.deadline = 0; syncDay(); await save(); }
    async function closeQuarter() {
      const S = compute(pub, sec, moves), cur = S.rounds[pub.round - 1];
      (pub.teams || []).forEach(t => {
        sec.notes[t.id] = (sec.notes[t.id] || []).filter(x => x.round !== pub.round);
        sec.notes[t.id].push({ round: pub.round, pts: cur.pts[t.id], lines: cur.why[t.id] });
      });
      pub.phase = 'done'; pub.day = null; await save();
    }
    async function endGame() {
      const S = compute(pub, sec, moves);
      pub.final = (pub.teams || []).map(t => ({ id: t.id, name: t.name, role: sec.roles[t.id], total: S.total[t.id] })).sort((a, b) => b.total - a.total);
      pub.phase = 'end'; await save(); show({ kind: 'scores', rows: pub.final });
    }
    function quarterSummary(T, cur) {
      const t = h('<div class="tbl"><table class="sm"><thead><tr><th>Команда</th><th class="n-right">Очки</th><th>За что</th></tr></thead><tbody></tbody></table></div>');
      T.forEach(tm => t.querySelector('tbody').append(h('<tr><td><b>' + esc(tm.name) + '</b></td><td class="n-right">' + fmt(cur.pts[tm.id]) + '</td><td style="font-size:.88rem">' + (cur.why[tm.id].map(esc).join('<br>') || '—') + '</td></tr>')));
      return t;
    }
    function drawTeams(T, role, open) {
      const d = h('<details class="sheet adm-card"' + (open ? ' open' : '') + '><summary><b>Команды, роли и коды</b> · ' + T.length + '</summary></details>');
      if (!T.length) { d.append(h('<p class="g-muted">Команд пока нет.</p>')); box.append(d); return; }
      const t = h('<div class="tbl"><table class="sm"><thead><tr><th>Команда</th><th>Участники</th><th>Роль</th><th>Код для телефона</th><th></th></tr></thead><tbody></tbody></table></div>');
      T.forEach(tm => {
        const code = sec.codes[tm.id];
        const tr = h('<tr><td><b>' + esc(tm.name) + '</b></td><td style="font-size:.86rem">' + (tm.members || []).map(esc).join(', ') + '</td><td>' + role(tm.id) + '</td><td><b class="g-code">' + code + '</b><div class="g-muted" style="font-size:.74rem;word-break:break-all">' + esc(teamLink(code)) + '</div></td><td></td></tr>');
        if (pub.phase === 'setup') {
          const del = h('<button type="button" class="btn ghost" style="padding:5px 10px;font-size:.85rem">Удалить</button>');
          del.onclick = () => dialog('<h3>Удалить «' + esc(tm.name) + '»?</h3><p>Её роль вернётся в набор, участники смогут зарегистрироваться заново.</p>', [{ t: 'Отмена', cls: 'ghost' }, { t: 'Удалить', on: () => { sec.pool.unshift(sec.roles[tm.id]); poolTouched = true; deleted.add(tm.id); delete sec.roles[tm.id]; delete sec.codes[tm.id]; pub.teams = T.filter(x => x !== tm); save(); } }]);
          tr.lastChild.append(del);
        }
        t.querySelector('tbody').append(tr);
      });
      d.append(t); box.append(d);
    }
    function drawScore(T, S, role) {
      const rows = T.slice().sort((a, b) => S.total[b.id] - S.total[a.id]);
      const c = h('<div class="sheet adm-card"><h3>Счёт (секретно)</h3><div class="tbl"><table class="sm"><thead><tr><th>#</th><th>Команда</th><th>Роль</th>' + S.rounds.map(x => '<th class="n-right">Кв. ' + x.r + '</th>').join('') + '<th class="n-right">Итого</th></tr></thead><tbody></tbody></table></div><p class="g-muted" style="font-size:.85rem">Текущий квартал считается предварительно, пока он не закрыт.</p></div>');
      rows.forEach((t, i) => c.querySelector('tbody').append(h('<tr><td>' + (i + 1) + '</td><td><b>' + esc(t.name) + '</b></td><td>' + role(t.id) + '</td>' + S.rounds.map(x => '<td class="n-right">' + fmt(x.pts[t.id]) + '</td>').join('') + '<td class="n-right"><b>' + S.total[t.id] + '</b></td></tr>')));
      box.append(c);
    }
    function drawHistory(T, S, role) {
      const c = h('<div class="sheet adm-card"><h3>Подробный ход игры</h3></div>');
      S.rounds.slice().reverse().forEach(x => {
        const d = h('<details class="gm-hist"' + (x.r === pub.round ? ' open' : '') + '><summary><b>Квартал ' + x.r + '</b> · ' + esc(x.cs ? x.cs.topic : '') + '</summary></details>');
        if (x.cs) d.append(h('<p style="font-size:.92rem">' + esc(x.cs.text) + ' <span class="adm-ans">Верно: ' + L[x.cs.c] + '</span></p>'));
        const t = h('<div class="tbl"><table class="sm"><thead><tr><th>Команда</th><th>Ответ</th><th>Аргументация</th><th>Ход</th><th class="n-right">Очки</th><th>За что</th></tr></thead><tbody></tbody></table></div>');
        T.forEach(tm => {
          const m = x.mv(tm.id) || {}, ro = sec.roles[tm.id];
          t.querySelector('tbody').append(h('<tr><td><b>' + esc(tm.name) + '</b><br>' + role(tm.id) + '</td><td>' + (m.answer != null ? L[m.answer] + (x.ok[tm.id] ? ' ✓' : ' ✗') : '—') + '</td><td class="gm-arg">' + esc(m.arg || '—') + '</td><td style="font-size:.86rem">' + (m.target ? esc(ROLE[ro].verb || '') + ': ' + esc(nm(m.target)) : '—') + '</td><td class="n-right">' + fmt(x.pts[tm.id]) + '</td><td style="font-size:.84rem">' + x.why[tm.id].map(esc).join('<br>') + '</td></tr>'));
        });
        d.append(t); c.append(d);
      });
      box.append(c);
    }
    function drawDanger() {
      const c = h('<details class="sheet adm-card"><summary><b>Новая игра</b></summary></details>');
      const row = h('<div class="adm-row" style="margin-top:10px"></div>');
      const same = h('<button type="button" class="btn ghost">Новая партия с теми же командами</button>');
      same.onclick = () => dialog('<h3>Начать новую партию?</h3><p>Команды и коды останутся, роли раздадутся заново, ответы и очки удалятся.</p>', [{ t: 'Отмена', cls: 'ghost' }, { t: 'Начать', on: async () => { try { await DB().adminGameReset(pin); const p = shuffle(rolesFor(pub.teams.length)); pub.teams.forEach((t, i) => { sec.roles[t.id] = p[i]; }); Object.assign(pub, { phase: 'setup', round: 0, caseIdx: null, deadline: 0, day: null, final: null }); Object.assign(sec, { rounds: [], notes: {}, pool: [] }); await save(); } catch (e) { fail(e); } } }]);
      const all = h('<button type="button" class="btn ghost" style="color:var(--bad)">Удалить всё и начать с нуля</button>');
      all.onclick = () => dialog('<h3>Удалить всю игру?</h3><p>Команды, коды, ответы и очки будут удалены. Отменить нельзя.</p>', [{ t: 'Отмена', cls: 'ghost' }, { t: 'Удалить', on: async () => { try { await DB().adminGameReset(pin); pub = { phase: 'setup', round: 0, maxRounds: QN, teams: [] }; sec = { roles: {}, codes: {}, pool: [], planned: sec.planned || 7, rounds: [], notes: {} }; await save(); } catch (e) { fail(e); } } }]);
      row.append(same, all); c.append(row); box.append(c);
    }
    return () => clearInterval(poll);
  }

  return {
    init(ctx) { C = ctx; h = ctx.h; dialog = ctx.dialog; },
    renderTeam(id, ctx) { this.init(ctx); ctx.view.innerHTML = ''; return renderTeam(id); },
    admin(box, pin, show, isActive, ctx) { this.init(ctx); return admin(box, pin, show, isActive); },
    compute, rolesFor, ROLE
  };
})();
