-- Игра «Налоговая мафия»: дополнение к schema.sql. Выполнить один раз в SQL Editor.
-- game.data        — открытое состояние (фаза, квартал, кейс, команды без ролей) — читают все, обновления в реальном времени
-- admin_state.data — секрет ведущих (роли, коды команд, итоги кварталов) — только через функции с PIN
-- team_moves       — ответы, аргументация и тайные ходы команд — пишут команды по своему коду, читают только ведущие

create table if not exists public.game (id int primary key default 1 check (id = 1), data jsonb not null default '{}'::jsonb, updated_at timestamptz default now());
insert into public.game (id) values (1) on conflict do nothing;
create table if not exists public.team_moves (round int not null, team_id text not null, answer int, arg text, target text, extra_answer int, extra_arg text, updated_at timestamptz default now(), primary key (round, team_id));
alter table public.game enable row level security;
alter table public.team_moves enable row level security;
grant select on public.game to anon, authenticated;
revoke all on public.team_moves from anon, authenticated;
drop policy if exists "read game" on public.game;
create policy "read game" on public.game for select to anon, authenticated using (true);

create or replace function public.team_of(c text) returns text language sql security definer set search_path = public as $$
  select key from admin_state, jsonb_each_text(coalesce(data->'codes', '{}'::jsonb)) where id = 1 and value = upper(trim(c)) limit 1; $$;
revoke execute on function public.team_of(text) from anon, authenticated, public;

create or replace function public.team_view(c text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid text; s jsonb; r int;
begin
  tid := team_of(c); if tid is null then raise exception 'Команда с таким кодом не найдена'; end if;
  select data into s from admin_state where id = 1;
  select coalesce((data->>'round')::int, 0) into r from game where id = 1;
  return jsonb_build_object('id', tid, 'role', s->'roles'->>tid, 'notes', coalesce(s->'notes'->tid, '[]'::jsonb),
    'move', (select to_jsonb(m) from team_moves m where m.round = r and m.team_id = tid),
    'prevTarget', (select m.target from team_moves m where m.round = r - 1 and m.team_id = tid));
end $$;

create or replace function public.team_submit(c text, rnd int, ans int, argument text, tgt text) returns void language plpgsql security definer set search_path = public as $$
declare tid text; g jsonb;
begin
  tid := team_of(c); if tid is null then raise exception 'Команда с таким кодом не найдена'; end if;
  select data into g from game where id = 1;
  if g->>'phase' is distinct from 'case' or (g->>'round')::int is distinct from rnd then raise exception 'Приём ответов на этот кейс закрыт'; end if;
  if ans is null or ans < 0 or ans > 3 then raise exception 'Выберите вариант ответа'; end if;
  insert into team_moves (round, team_id, answer, arg, target, updated_at) values (rnd, tid, ans, left(coalesce(argument, ''), 1500), nullif(tgt, ''), now())
  on conflict (round, team_id) do update set answer = excluded.answer, arg = excluded.arg, target = excluded.target, updated_at = now();
end $$;

create or replace function public.team_extra(c text, rnd int, ans int, argument text) returns void language plpgsql security definer set search_path = public as $$
declare tid text; g jsonb;
begin
  tid := team_of(c); if tid is null then raise exception 'Команда с таким кодом не найдена'; end if;
  select data into g from game where id = 1;
  if g->>'phase' is distinct from 'day' or (g->>'round')::int is distinct from rnd or g->'day'->>'victim' is distinct from tid then raise exception 'Дополнительный кейс сейчас недоступен'; end if;
  if ans is null or ans < 0 or ans > 3 then raise exception 'Выберите вариант ответа'; end if;
  if exists (select 1 from team_moves where round = rnd and team_id = tid and extra_answer is not null) then raise exception 'Ответ на дополнительный кейс уже отправлен'; end if;
  insert into team_moves (round, team_id, extra_answer, extra_arg, updated_at) values (rnd, tid, ans, left(coalesce(argument, ''), 1500), now())
  on conflict (round, team_id) do update set extra_answer = excluded.extra_answer, extra_arg = excluded.extra_arg, updated_at = now();
end $$;

create or replace function public.admin_game(p text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not admin_check(p) then raise exception 'Неверный PIN'; end if;
  return jsonb_build_object('game', (select data from game where id = 1), 'secret', (select data from admin_state where id = 1),
    'moves', (select coalesce(jsonb_agg(to_jsonb(m) order by m.round, m.team_id), '[]'::jsonb) from team_moves m));
end $$;

create or replace function public.admin_game_set(p text, pub jsonb, sec jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  if not admin_check(p) then raise exception 'Неверный PIN'; end if;
  update game set data = coalesce(pub, '{}'::jsonb), updated_at = now() where id = 1;
  if sec is not null then update admin_state set data = sec, updated_at = now() where id = 1; end if;
end $$;

create or replace function public.admin_game_reset(p text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not admin_check(p) then raise exception 'Неверный PIN'; end if;
  delete from team_moves where round is not null;
end $$;

grant execute on function public.team_view(text), public.team_submit(text, int, int, text, text), public.team_extra(text, int, int, text),
  public.admin_game(text), public.admin_game_set(text, jsonb, jsonb), public.admin_game_reset(text) to anon, authenticated;

do $$ begin alter publication supabase_realtime add table public.game; exception when duplicate_object then null; end $$;

-- Саморегистрация команды с телефона: название + участники из списка. Роль берётся из заранее перемешанного набора (pool),
-- код генерируется здесь же. Регистрация открыта, пока игра в фазе «setup».
create or replace function public.team_register(tname text, members jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare g jsonb; s jsonb; nm text := left(trim(coalesce(tname, '')), 40); taken text[]; m text; pool jsonb; ro text; tid text; code text;
  abc text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int; mem jsonb := '[]'::jsonb; n int;
begin
  select data into g from game where id = 1 for update;
  select data into s from admin_state where id = 1 for update;
  g := coalesce(g, '{}'::jsonb);
  if coalesce(g->>'phase', 'setup') <> 'setup' then raise exception 'Игра уже началась — регистрация закрыта. Войдите по коду команды.'; end if;
  if length(nm) < 2 then raise exception 'Введите название команды'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(g->'teams', '[]'::jsonb)) t where lower(t->>'name') = lower(nm)) then raise exception 'Такое название уже занято'; end if;
  if jsonb_typeof(members) is distinct from 'array' or jsonb_array_length(members) = 0 then raise exception 'Отметьте участников команды'; end if;
  select coalesce(array_agg(x), '{}') into taken from jsonb_array_elements(coalesce(g->'teams', '[]'::jsonb)) t, jsonb_array_elements_text(t->'members') x;
  for m in select left(trim(x), 80) from jsonb_array_elements_text(members) x loop
    if m = any(taken) then raise exception 'Уже в другой команде: %', m; end if;
    if not mem ? m then mem := mem || to_jsonb(m); end if;
  end loop;
  if jsonb_array_length(mem) > 12 then raise exception 'Слишком много участников'; end if;
  if s is null or s->'codes' is null then s := jsonb_build_object('roles', '{}'::jsonb, 'codes', '{}'::jsonb, 'pool', '[]'::jsonb, 'planned', 7, 'rounds', '[]'::jsonb, 'notes', '{}'::jsonb); end if;
  pool := coalesce(s->'pool', '[]'::jsonb);
  if jsonb_array_length(pool) = 0 then
    if jsonb_array_length(coalesce(g->'teams', '[]'::jsonb)) = 0 then
      n := coalesce((s->>'planned')::int, 7);
      select jsonb_agg(r order by random()) into pool from unnest(array['mafia', 'consultant'] || case when n >= 4 then array['mimic'] else '{}'::text[] end
        || array_fill('auditor'::text, array[greatest(n - case when n >= 4 then 3 else 2 end, 0)])) r;
    else pool := '["auditor"]'::jsonb; end if;
  end if;
  ro := pool->>0; pool := pool - 0;
  tid := substr(md5(random()::text || clock_timestamp()::text), 1, 6);
  loop
    code := ''; for i in 1..4 loop code := code || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from jsonb_each_text(coalesce(s->'codes', '{}'::jsonb)) where value = code);
  end loop;
  s := jsonb_set(s, '{roles}', coalesce(s->'roles', '{}'::jsonb) || jsonb_build_object(tid, ro));
  s := jsonb_set(s, '{codes}', coalesce(s->'codes', '{}'::jsonb) || jsonb_build_object(tid, code));
  s := jsonb_set(s, '{pool}', pool);
  if g->>'phase' is null then g := g || '{"phase":"setup","round":0,"maxRounds":5}'::jsonb; end if;
  g := jsonb_set(g, '{teams}', coalesce(g->'teams', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', tid, 'name', nm, 'members', mem)));
  update game set data = g, updated_at = now() where id = 1;
  update admin_state set data = s, updated_at = now() where id = 1;
  return jsonb_build_object('code', code, 'id', tid);
end $$;
grant execute on function public.team_register(text, jsonb) to anon, authenticated;
