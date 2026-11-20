-- Сайт «Налоговая отчётность · Команда 8» — база Supabase.
-- Выполните целиком в Supabase: SQL Editor → New query → вставить → Run.
-- Повторный запуск безопасен.

-- ============ таблицы ============
create table if not exists public.results (          -- Exit-ticket
  no         int primary key,
  name       text not null,
  v          int,
  score      int not null,
  max        int not null,
  leaves     int default 0,
  away_sec   int default 0,
  mins       int default 0,
  detail     jsonb,
  code       text,
  created_at timestamptz default now()
);

create table if not exists public.practice (         -- работа на закрепление
  no         int primary key,
  name       text not null,
  score      int not null,
  max        int not null default 10,
  answers    jsonb,
  created_at timestamptz default now()
);

create table if not exists public.screen (           -- что сейчас показано на проекторе
  id         int primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.admin_state (      -- ход игры (виден только ведущим)
  id         int primary key default 1 check (id = 1),
  data       jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.app_secret (       -- PIN ведущих
  id  int primary key default 1 check (id = 1),
  pin text not null
);

insert into public.screen (id) values (1) on conflict do nothing;
insert into public.admin_state (id) values (1) on conflict do nothing;
insert into public.app_secret (id, pin) values (1, '0808') on conflict do nothing;
-- Смените PIN: update public.app_secret set pin = 'ваш PIN' where id = 1;

-- ============ доступ ============
alter table public.results     enable row level security;
alter table public.practice    enable row level security;
alter table public.screen      enable row level security;
alter table public.admin_state enable row level security;
alter table public.app_secret  enable row level security;

-- права на таблицы (нужны, если в проекте выключено автоматическое открытие таблиц для API)
grant usage on schema public to anon, authenticated;
grant insert on public.results, public.practice to anon, authenticated;
grant select on public.screen to anon, authenticated;
revoke all on public.admin_state, public.app_secret from anon, authenticated;

-- студенты могут только добавить свой результат (один раз на имя — primary key)
drop policy if exists "insert exit-ticket" on public.results;
create policy "insert exit-ticket" on public.results for insert to anon, authenticated
  with check (score between 0 and max and max between 1 and 100);
drop policy if exists "insert practice" on public.practice;
create policy "insert practice" on public.practice for insert to anon, authenticated
  with check (score between 0 and 10 and max = 10);
-- экран читают все (нужно для проектора и обновлений в реальном времени)
drop policy if exists "read screen" on public.screen;
create policy "read screen" on public.screen for select to anon, authenticated using (true);
-- admin_state и app_secret напрямую не читаются никем — только через функции с PIN ниже

-- ============ функции ============
create or replace function public.submitted_nos(t text) returns int[]
language sql security definer set search_path = public as $$
  select coalesce(array_agg(no), '{}') from (
    select no from results where t = 'results'
    union all select no from practice where t = 'practice') s;
$$;

create or replace function public.admin_check(p text) returns boolean
language sql security definer set search_path = public as $$
  select exists (select 1 from app_secret where pin = p);
$$;

create or replace function public.admin_load(p text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not admin_check(p) then raise exception 'Неверный PIN'; end if;
  return jsonb_build_object(
    'results',  (select coalesce(jsonb_agg(to_jsonb(r) order by r.no), '[]'::jsonb) from results r),
    'practice', (select coalesce(jsonb_agg(to_jsonb(x) order by x.no), '[]'::jsonb) from practice x),
    'game',     (select data from admin_state where id = 1));
end $$;

create or replace function public.admin_save_game(p text, d jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_check(p) then raise exception 'Неверный PIN'; end if;
  update admin_state set data = d, updated_at = now() where id = 1;
end $$;

create or replace function public.screen_set(p text, d jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_check(p) then raise exception 'Неверный PIN'; end if;
  update screen set data = d, updated_at = now() where id = 1;
end $$;

create or replace function public.admin_clear(p text, t text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_check(p) then raise exception 'Неверный PIN'; end if;
  if t = 'results'  then delete from results  where no is not null; end if;
  if t = 'practice' then delete from practice where no is not null; end if;
end $$;

grant execute on function public.submitted_nos(text), public.admin_check(text), public.admin_load(text),
  public.admin_save_game(text, jsonb), public.screen_set(text, jsonb), public.admin_clear(text, text) to anon, authenticated;

-- ============ обновления экрана в реальном времени ============
do $$ begin
  alter publication supabase_realtime add table public.screen;
exception when duplicate_object then null; end $$;
