/* Слой данных сайта. С настройками Supabase (config.js) — общая база для всех устройств.
   Без них — всё хранится в этом браузере, а экран проектора обновляется между вкладками одного компьютера. */
(function () {
  "use strict";
  const C = window.K8_CONFIG || {};
  const LOCAL_PIN = '0808';
  let sb = null;
  try { if (C.supabaseUrl && C.supabaseKey && window.supabase) sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, { auth: { persistSession: false } }); } catch (e) { sb = null; }
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };
  let bc = null; try { bc = new BroadcastChannel('k8-screen'); } catch (e) { bc = null; }
  const fail = e => { throw new Error(e && e.message ? e.message : 'Нет связи с базой.'); };

  window.K8DB = {
    online: !!sb,
    /* номера студентов, уже сдавших работу: table = 'results' | 'practice' */
    async submitted(table) {
      if (!sb) return [];
      const { data, error } = await sb.rpc('submitted_nos', { t: table }); if (error) fail(error);
      return Array.isArray(data) ? data : [];
    },
    /* добавить результат; повтор по тому же номеру не перезаписывает */
    async insert(table, row) {
      if (!sb) return { local: true };
      const { error } = await sb.from(table).insert(row);
      if (error && error.code !== '23505') fail(error);
      return { dup: !!error };
    },
    async checkPin(pin) {
      if (!sb) return pin === LOCAL_PIN;
      const { data, error } = await sb.rpc('admin_check', { p: pin }); if (error) fail(error); return !!data;
    },
    async adminLoad(pin) {
      if (!sb) return { results: [], practice: [], game: LS.get('k8_admin_game', null) };
      const { data, error } = await sb.rpc('admin_load', { p: pin }); if (error) fail(error);
      return data || {};
    },
    async saveGame(pin, game) {
      LS.set('k8_admin_game', game);
      if (!sb) return;
      const { error } = await sb.rpc('admin_save_game', { p: pin, d: game }); if (error) fail(error);
    },
    async clear(pin, table) {
      if (!sb) return;
      const { error } = await sb.rpc('admin_clear', { p: pin, t: table }); if (error) fail(error);
    },
    /* игра: открытое состояние, телефоны команд, секретная часть ведущих */
    async rpc(name, args) {
      if (!sb) throw new Error('Игра работает только с общей базой Supabase (public/config.js).');
      const { data, error } = await sb.rpc(name, args); if (error) fail(error); return data;
    },
    async gameGet() {
      if (!sb) return {};
      const { data, error } = await sb.from('game').select('data').eq('id', 1).maybeSingle(); if (error) fail(error);
      return data ? data.data || {} : {};
    },
    watchGame(cb) {
      if (!sb) return () => { };
      const ch = sb.channel('game-' + Math.random().toString(36).slice(2))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'game' }, p => { if (p.new && p.new.data) cb(p.new.data); })
        .subscribe();
      return () => { try { sb.removeChannel(ch); } catch (e) { } };
    },
    teamView(code) { return this.rpc('team_view', { c: code }); },
    teamSubmit(code, rnd, ans, argument, tgt) { return this.rpc('team_submit', { c: code, rnd, ans, argument, tgt: tgt || '' }); },
    teamExtra(code, rnd, ans, argument) { return this.rpc('team_extra', { c: code, rnd, ans, argument }); },
    adminGame(pin) { return this.rpc('admin_game', { p: pin }); },
    adminGameSet(pin, pub, sec) { return this.rpc('admin_game_set', { p: pin, pub, sec }); },
    adminGameReset(pin) { return this.rpc('admin_game_reset', { p: pin }); },
    /* экран проектора */
    async setScreen(pin, data) {
      LS.set('k8_screen', data); if (bc) bc.postMessage(data);
      if (!sb) return;
      const { error } = await sb.rpc('screen_set', { p: pin, d: data }); if (error) fail(error);
    },
    async getScreen() {
      if (!sb) return LS.get('k8_screen', {});
      const { data, error } = await sb.from('screen').select('data').eq('id', 1).maybeSingle(); if (error) fail(error);
      return data ? data.data : {};
    },
    watchScreen(cb) {
      const off = [];
      if (bc) { const f = e => cb(e.data); bc.addEventListener('message', f); off.push(() => bc.removeEventListener('message', f)); }
      const st = e => { if (e.key === 'k8_screen' && e.newValue) { try { cb(JSON.parse(e.newValue)); } catch (x) { } } };
      window.addEventListener('storage', st); off.push(() => window.removeEventListener('storage', st));
      if (sb) {
        const ch = sb.channel('screen-' + Math.random().toString(36).slice(2))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'screen' }, p => { if (p.new && p.new.data) cb(p.new.data); })
          .subscribe();
        off.push(() => { try { sb.removeChannel(ch); } catch (e) { } });
      }
      return () => off.forEach(f => f());
    }
  };
})();
