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
