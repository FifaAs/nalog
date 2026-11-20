'use strict';
/* Сервер сайта и игры «Налоговая мафия».
   Без внешних зависимостей: отдаёт файлы из public/, состояние игры рассылает
   через Server-Sent Events (/api/stream), действия принимает через POST /api/act.
   Запуск: node server.js  (порт PORT, PIN ведущего HOST_PIN, по умолчанию 0808) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Q = require('./game-questions');

const PORT = +process.env.PORT || 3000;
const HOST_PIN = String(process.env.HOST_PIN || '0808');
const PUB = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA = path.join(DATA_DIR, 'game.json');

const ROLE_NAME = { mafia: 'Схемщики', consultant: 'Консультант', mimic: 'Мимик', auditor: 'Аудитор' };
const PTS = { correct: 10, extraOk: 5, extraFail: -10, mafiaGain: 10, save: 5, trap: 15, auditOk: 5, auditFail: -5, auditGain: 5 };
const MAIN = Q.main, EXTRA = Q.extra, ORAL = Q.oral;

const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');
const clean = (s, max) => String(s == null ? '' : s).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

function fresh(hosts) {
  return { gid: rid(6), phase: 'lobby', round: 0, maxRounds: 5, teams: [], used: [], usedExtra: [], qi: null,
    subs: {}, night: null, day: null, res: null, qdelta: {}, deadline: 0, history: [], hosts: hosts || [] };
}
function load() { try { const g = JSON.parse(fs.readFileSync(DATA, 'utf8')); return g && g.usedExtra ? g : null; } catch (e) { return null; } }
let G = load() || fresh();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DATA, JSON.stringify(G)); } catch (e) { console.error('save', e.message); } }, 200);
}

/* ---------- результаты самостоятельной работы ---------- */
const RES_FILE = path.join(DATA_DIR, 'results.json');
let RESULTS = (() => { try { return JSON.parse(fs.readFileSync(RES_FILE, 'utf8')); } catch (e) { return []; } })();
function saveResults() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(RES_FILE, JSON.stringify(RESULTS)); } catch (e) { console.error('results', e.message); } }
const int = (x, lo, hi) => { x = Math.round(+x); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo; };
function cleanResult(r) {
  r = r || {};
  const no = int(r.no, 0, 9999); need(no > 0, 'Нет номера студента.');
  return { no, name: clean(r.name, 120), v: int(r.v, 1, 9), score: int(r.score, 0, 1000), max: int(r.max, 0, 1000),
    leaves: int(r.leaves, 0, 100000), awaySec: int(r.awaySec, 0, 1e7), mins: int(r.mins, 0, 100000),
    detail: (Array.isArray(r.detail) ? r.detail : []).slice(0, 50).map(d => d ? 1 : 0),
    code: clean(r.code, 60), at: clean(r.at, 40), received: new Date().toISOString() };
}
const journalAuth = b => String(b.pin || '') === HOST_PIN || isHost(b.token);

const team = id => G.teams.find(t => t.id === id);
const byRole = r => G.teams.find(t => t.role === r);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/* 1 Схемщики, 1 Консультант, 1 Мимик (при 4+ командах), остальные — Аудиторы */
function rolesFor(n) { const r = ['mafia', 'consultant']; if (n >= 4) r.push('mimic'); while (r.length < n) r.push('auditor'); return r; }
function roleCounts() { const c = {}; if (G.phase === 'lobby') return c; rolesFor(G.teams.length).forEach(r => { c[r] = (c[r] || 0) + 1; }); return c; }
const auditorsOf = id => (G.night && G.night.audits[id]) || [];

/* ---------- views ---------- */
function qView() {
  if (G.qi == null || !['case', 'day', 'summary'].includes(G.phase)) return null;
  const q = MAIN[G.qi]; const o = { n: G.qi, topic: q.topic, text: q.text, opts: q.opts };
  if (G.phase !== 'case') Object.assign(o, { c: q.c, expl: q.expl, ref: q.ref });
  return o;
}
function nightView() {
  if (!G.night || !['day', 'summary'].includes(G.phase)) return null;
  const n = G.night;
  return { ok: n.ok, victim: n.victim, schemeMsg: n.victim ? '«' + team(n.victim).name + '» получает дополнительный кейс от Схемщиков.' : 'Схема этой ночью сорвалась.',
    audited: Object.keys(n.audits), extraDone: !!(G.day && G.day.extra), marks: G.day ? G.day.marks : {} };
}
function pub() {
  const end = G.phase === 'end';
  return {
    gid: G.gid, phase: G.phase, round: G.round, maxRounds: G.maxRounds, deadline: G.deadline, now: Date.now(),
    counts: roleCounts(), q: qView(), night: nightView(), res: G.res, history: G.history,
    teams: G.teams.map(t => ({ id: t.id, name: t.name, members: t.members, correct: t.correct,
      role: end ? t.role : null, score: end ? t.score : null,
      done: G.phase === 'case' ? !!G.subs[t.id] : false }))
  };
}
function extraView(withAnswer) {
  if (!G.day || G.day.extraQi == null) return null;
  const e = EXTRA[G.day.extraQi]; const o = { topic: e.topic, text: e.text, opts: e.opts, a: G.day.extra ? G.day.extra.a : null };
  if (withAnswer || G.phase !== 'day') Object.assign(o, { c: e.c, expl: e.expl, ref: e.ref });
  return o;
}
function teamView(t, p) {
  const victim = G.night && G.night.victim === t.id;
  return Object.assign({}, p, { me: { id: t.id, name: t.name, code: t.code, members: t.members, role: t.role, score: t.score,
    lastProtect: t.lastProtect, intel: t.intel, sub: G.subs[t.id] || null, qdelta: G.qdelta ? G.qdelta[t.id] || 0 : 0,
    victim, extra: victim ? extraView(false) : null, audited: !!(G.night && G.night.audits[t.id]) } });
}
function hostView(p) {
  return Object.assign({}, p, { host: true,
    all: G.teams.map(t => ({ id: t.id, name: t.name, code: t.code, members: t.members, role: t.role, score: t.score, correct: t.correct,
      sub: G.subs[t.id] || null, auditors: auditorsOf(t.id).map(id => team(id).name) })),
    bank: MAIN.map((q, i) => ({ i, topic: q.topic, text: q.text, c: q.c, used: G.used.includes(i) })),
    oral: ORAL, extra: extraView(true), qdelta: G.qdelta || {} });
}

/* ---------- game logic ---------- */
function add(t, v) { if (!t) return; t.score += v; G.qdelta[t.id] = (G.qdelta[t.id] || 0) + v; }
const note = (t, txt, tone) => t && t.intel.push({ round: G.round, txt, tone });

/* после кейса: очки за ответ и тайные ходы */
function resolveNight() {
  const q = MAIN[G.qi], ok = {};
  G.teams.forEach(t => { const s = G.subs[t.id]; ok[t.id] = !!s && s.a === q.c; if (ok[t.id]) { add(t, PTS.correct); t.correct++; } });
  const maf = byRole('mafia'), con = byRole('consultant'), mim = byRole('mimic');
  const night = { ok, victim: null, scheme: 'none', audits: {} };
  let prot = null;
  if (con) {
    const s = G.subs[con.id]; con.lastProtect = s && s.t ? s.t : null;
    if (s && s.t && ok[con.id]) prot = s.t;
    else note(con, s ? 'Защита не сработала: ошибка в кейсе.' : 'Вы не отправили ответ.', 'bad');
  }
  if (maf) {
    const s = G.subs[maf.id];
    if (!s || !s.t || !ok[maf.id]) note(maf, 'Схема не сработала: ошибка в кейсе или нет ответа.', 'bad');
    else if (mim && s.t === mim.id) {
      night.scheme = 'trap'; add(mim, PTS.trap);
      note(maf, '«' + mim.name + '» оказался Мимиком — схема сгорела.', 'bad');
      note(mim, 'Схемщики выбрали вас: ловушка сработала, +' + PTS.trap + '.', 'good');
    } else if (s.t === prot) {
      night.scheme = 'saved'; add(con, PTS.save);
      note(maf, 'Консультант защитил «' + team(s.t).name + '» — схема сорвана.', 'bad');
      note(con, 'Вы спасли «' + team(s.t).name + '» от схемы: +' + PTS.save + '.', 'good');
    } else {
      night.scheme = 'victim'; night.victim = s.t;
      note(maf, 'Схема против «' + team(s.t).name + '»: днём она решает дополнительный кейс.', 'good');
    }
  }
  if (con && prot && night.scheme !== 'saved') note(con, 'Вы защищали «' + team(prot).name + '», но Схемщики выбрали другую команду.', '');
  G.teams.filter(t => t.role === 'auditor').forEach(a => {
    const s = G.subs[a.id];
    if (s && s.t && ok[a.id]) (night.audits[s.t] = night.audits[s.t] || []).push(a.id);
    else note(a, 'Вопрос не назначен: ' + (s ? 'ошибка в кейсе.' : 'нет ответа.'), 'bad');
  });
  G.night = night;
  let extraQi = null;
  if (night.victim) { extraQi = EXTRA.findIndex((_, i) => !G.usedExtra.includes(i)); if (extraQi < 0) { G.usedExtra = []; extraQi = 0; } G.usedExtra.push(extraQi); }
  G.day = { extraQi, extra: null, marks: {} };
}

/* после дня: доп. кейс жертвы и вопросы Аудиторов */
function settle() {
  const n = G.night, ev = [];
  const maf = byRole('mafia');
  if (n.victim) {
    const v = team(n.victim), e = EXTRA[G.day.extraQi], a = G.day.extra ? G.day.extra.a : null;
    if (a === e.c) { add(v, PTS.extraOk); ev.push({ k: 'good', txt: '«' + v.name + '» решила дополнительный кейс: +' + PTS.extraOk + '.' }); note(maf, '«' + v.name + '» решила доп. кейс — схема раскрыта.', 'bad'); }
    else { add(v, PTS.extraFail); add(maf, PTS.mafiaGain); ev.push({ k: 'hit', txt: '«' + v.name + '» не решила дополнительный кейс: ' + PTS.extraFail + '.' }); note(maf, '«' + v.name + '» не решила доп. кейс: +' + PTS.mafiaGain + '.', 'good'); }
  } else ev.push({ k: '', txt: 'Схема этой ночью сорвалась — дополнительного кейса не было.' });
  Object.entries(n.audits).forEach(([tid, auds]) => {
    const t = team(tid), m = G.day.marks[tid];
    if (m === true) { add(t, PTS.auditOk); ev.push({ k: 'good', txt: '«' + t.name + '» ответила на вопрос Аудитора: +' + PTS.auditOk + '.' }); auds.forEach(id => note(team(id), '«' + t.name + '» ответила на ваш вопрос.', '')); }
    else if (m === false) { add(t, PTS.auditFail); ev.push({ k: 'hit', txt: '«' + t.name + '» не ответила на вопрос Аудитора: ' + PTS.auditFail + '.' }); auds.forEach(id => { add(team(id), PTS.auditGain); note(team(id), '«' + t.name + '» не ответила на ваш вопрос: +' + PTS.auditGain + '.', 'good'); }); }
    else ev.push({ k: '', txt: 'Вопрос для «' + t.name + '» не был задан.' });
  });
  G.res = { round: G.round, ev };
  G.history.push({ round: G.round, q: G.qi, ok: n.ok, ev: ev.map(e => e.txt) });
  G.phase = G.round >= G.maxRounds ? 'end' : 'summary'; G.deadline = 0;
}

function need(cond, msg) { if (!cond) throw new Error(msg); }
const isHost = tk => !!tk && G.hosts.includes(tk);
const byToken = tk => tk ? G.teams.find(t => t.token === tk) : null;
const secs = s => { s = +s || 0; return s > 0 ? Date.now() + Math.min(s, 900) * 1000 : 0; };

const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() { let c; do { c = Array.from({ length: 4 }, () => CODE_ABC[crypto.randomInt(CODE_ABC.length)]).join(''); } while (G.teams.some(t => t.code === c)); return c; }
const blankTeam = () => ({ role: null, score: 0, correct: 0, intel: [], lastProtect: null });
function createTeam(b) {
  need(G.phase === 'lobby', 'Игра уже началась — создавать команды можно только до старта.');
  const name = clean(b.name, 40); need(name.length >= 2, 'Введите название команды.');
  need(!G.teams.some(t => t.name.toLowerCase() === name.toLowerCase()), 'Такое название уже занято.');
  need(G.teams.length < 10, 'Максимум 10 команд.');
  const members = [...new Set((Array.isArray(b.members) ? b.members : []).map(x => clean(x, 80)).filter(Boolean))].slice(0, 12);
  need(members.length > 0, 'Добавьте участников команды.');
  const taken = new Set(G.teams.flatMap(t => t.members)); const dup = members.filter(m => taken.has(m));
  need(!dup.length, 'Уже в другой команде: ' + dup.join(', '));
  const t = Object.assign({ id: rid(4), name, members, token: rid(), code: newCode() }, blankTeam());
  G.teams.push(t); return t;
}

const ACT = {
  join(b) { const t = createTeam(b); return { token: t.token, code: t.code }; },
  /* войти в существующую команду по коду — с любого телефона и на любом этапе игры */
  enter(b) {
    const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const t = G.teams.find(x => x.code === code); need(t, 'Команда с таким кодом не найдена.');
    return { token: t.token, code: t.code, name: t.name };
  },
  create(b) { const t = createTeam(b); return { code: t.code, name: t.name }; },
  login(b) { need(String(b.pin || '') === HOST_PIN, 'Неверный PIN.'); const tk = rid(); G.hosts = G.hosts.concat(tk).slice(-10); return { token: tk }; },
  /* ответ на кейс + тайный ход (у Мимика хода нет) */
  answer(b) {
    const t = byToken(b.token); need(t, 'Команда не найдена.'); need(G.phase === 'case', 'Приём ответов закрыт.');
    const a = +b.a; need(Number.isInteger(a) && a >= 0 && a < MAIN[G.qi].opts.length, 'Выберите ответ.');
    let target = null;
    if (t.role !== 'mimic') {
      const tg = team(b.t); need(tg, 'Выберите команду для хода.');
      need(tg !== t || t.role === 'consultant', 'Нельзя выбрать свою команду.');
      need(!(t.role === 'consultant' && tg.id === t.lastProtect), 'Одну команду нельзя защищать два квартала подряд.');
      target = tg.id;
    }
    G.subs[t.id] = { a, t: target };
  },
  /* жертва схемы решает дополнительный кейс — одна попытка */
  extra(b) {
    const t = byToken(b.token); need(t, 'Команда не найдена.'); need(G.phase === 'day', 'Сейчас не день.');
    need(G.night && G.night.victim === t.id, 'Дополнительный кейс есть только у команды, выбранной Схемщиками.');
    need(!G.day.extra, 'Ответ на дополнительный кейс уже отправлен.');
    const a = +b.a; need(Number.isInteger(a) && a >= 0 && a < EXTRA[G.day.extraQi].opts.length, 'Выберите ответ.');
    G.day.extra = { a };
  },
  /* host */
  start(b) {
    need(G.phase === 'lobby', 'Игра уже идёт.'); need(G.teams.length >= 3, 'Нужно минимум 3 команды.');
    G.maxRounds = Math.max(1, Math.min(MAIN.length, +b.rounds || 5));
    const r = shuffle(rolesFor(G.teams.length)); G.teams.forEach((t, i) => { Object.assign(t, blankTeam(), { role: r[i] }); });
    G.phase = 'roles'; G.round = 0;
  },
  next(b) {
    need(G.phase === 'roles' || G.phase === 'summary', 'Сейчас нельзя начать квартал.'); need(G.round < G.maxRounds, 'Все кварталы сыграны.');
    const qi = +b.qi; need(Number.isInteger(qi) && MAIN[qi], 'Выберите кейс.');
    G.round++; G.qi = qi; if (!G.used.includes(qi)) G.used.push(qi);
    G.subs = {}; G.night = null; G.day = null; G.res = null; G.qdelta = {}; G.phase = 'case'; G.deadline = secs(b.secs);
  },
  reveal() { need(G.phase === 'case', 'Сейчас не приём ответов.'); resolveNight(); G.phase = 'day'; G.deadline = 0; },
  mark(b) {
    need(G.phase === 'day', 'Оценивать вопросы можно только днём.'); need(G.night && G.night.audits[b.id], 'Эту команду Аудиторы не выбирали.');
    if (b.ok === null) delete G.day.marks[b.id]; else G.day.marks[b.id] = !!b.ok;
  },
  settle() { need(G.phase === 'day', 'Сейчас не день.'); settle(); },
  finish() { need(!['lobby', 'end'].includes(G.phase), 'Игра не идёт.'); if (G.phase === 'day') settle(); G.phase = 'end'; G.deadline = 0; },
  kick(b) { need(G.phase === 'lobby', 'Удалять команды можно только до старта.'); G.teams = G.teams.filter(t => t.id !== b.id); },
  rematch() {
    need(G.phase === 'end', 'Партия ещё не закончена.');
    const keep = G.teams.map(t => Object.assign({ id: t.id, name: t.name, members: t.members, token: t.token, code: t.code }, blankTeam()));
    G = fresh(G.hosts); G.teams = keep;
  },
  reset() { G = fresh(G.hosts); },
  /* самостоятельная работа */
  submit(b) {
    const r = cleanResult(b.result); const old = RESULTS.find(x => x.no === r.no);
    if (old) return { dup: true, code: old.code };
    RESULTS.push(r); saveResults(); return { saved: true };
  },
  results(b) { need(journalAuth(b), 'Неверный PIN.'); return { results: RESULTS }; },
  clearResults(b) { need(journalAuth(b), 'Неверный PIN.'); RESULTS = []; saveResults(); }
};
const NO_BROADCAST = new Set(['submit', 'results', 'clearResults', 'login']);
const HOST_ONLY = new Set(['create', 'start', 'next', 'reveal', 'mark', 'settle', 'finish', 'kick', 'rematch', 'reset']);

/* ---------- streaming ---------- */
const clients = new Set();
function viewFor(c, p) {
  if (isHost(c.token)) return hostView(p);
  const t = byToken(c.token); if (t) return teamView(t, p);
  return c.token && c.token !== 'screen' ? Object.assign({ error: 'unknown_token' }, p) : p;
}
function broadcast() { const p = pub(); for (const c of clients) { try { c.res.write('data: ' + JSON.stringify(viewFor(c, p)) + '\n\n'); } catch (e) { /* closed */ } } }
setInterval(() => { for (const c of clients) { try { c.res.write(': ping\n\n'); } catch (e) { } } }, 20000);

/* ---------- http ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const c = { res, token: url.searchParams.get('token') || '' };
    clients.add(c); res.write('retry: 2000\n\n'); res.write('data: ' + JSON.stringify(viewFor(c, pub())) + '\n\n');
    req.on('close', () => clients.delete(c));
    return;
  }
  if (url.pathname === '/api/act' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 20000) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(body || '{}'); } catch (e) { return json(res, 400, { ok: false, error: 'Неверный запрос.' }); }
      const fn = ACT[b.type]; if (!fn) return json(res, 400, { ok: false, error: 'Неизвестное действие.' });
      if (HOST_ONLY.has(b.type) && !isHost(b.token)) return json(res, 403, { ok: false, error: 'Нужен вход ведущего.' });
      try { const out = fn(b) || {}; if (!NO_BROADCAST.has(b.type) || b.type === 'login') save(); if (!NO_BROADCAST.has(b.type)) broadcast(); json(res, 200, Object.assign({ ok: true }, out)); }
      catch (e) { json(res, 400, { ok: false, error: e.message }); }
    });
    return;
  }
  if (url.pathname === '/api/submitted') return json(res, 200, { ok: true, nos: RESULTS.map(r => r.no) });
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, phase: G.phase, teams: G.teams.length, clients: clients.size });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let p = decodeURIComponent(url.pathname); if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});
server.listen(PORT, () => console.log('Сайт и игра: http://localhost:' + PORT + '  (PIN ведущего: ' + (process.env.HOST_PIN ? 'из HOST_PIN' : '0808') + ')'));
