-- =====================================================================
-- 学期任务站 · Supabase 数据库初始化脚本
-- 用法：Supabase 控制台 → 左侧 SQL Editor → 新建查询 → 整段粘贴 → Run
-- 注意：执行前，把第 7 节 authors 里的邮箱改成你自己的登录邮箱。
--       本脚本可反复执行（幂等），不会破坏已有数据。
--
-- 权限模型：谁在 authors 表里，谁就是作者 —— 作者之间权限完全相同，
--           都能编辑学习任务、班会活动，以及管理评论。
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. 数据表
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 200),
  course      text not null default '' check (char_length(course) <= 60),
  detail      text not null default '' check (char_length(detail) <= 2000),
  ddl         timestamptz,
  priority    text not null default 'mid' check (priority in ('high','mid','low')),
  status      text not null default 'todo' check (status in ('todo','doing','done')),
  tags        text[] not null default '{}',
  sort_order  integer not null default 0,
  repeat_rule text not null default '' check (repeat_rule in ('', 'weekly')),
  weekday     smallint check (weekday between 1 and 7),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 兼容「已经建过表」的情况：安全地补充周期任务字段（可重复执行）
alter table public.tasks add column if not exists repeat_rule text not null default '';
alter table public.tasks add column if not exists weekday smallint;

-- 班会活动：与学习任务完全分开的另一张表
create table if not exists public.activities (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 200),
  activity_at timestamptz,
  location    text not null default '' check (char_length(location) <= 80),
  category    text not null default '' check (char_length(category) <= 60),
  detail      text not null default '' check (char_length(detail) <= 2000),
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  nickname    text not null default '访客' check (char_length(nickname) <= 24),
  content     text not null check (char_length(content) between 1 and 120),
  color       text not null default '#7cc4ff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_hidden   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.site_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- 作者名单：在里面 = 作者（权限一律相同）
create table if not exists public.authors (
  email      text primary key,
  name       text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists tasks_ddl_idx      on public.tasks (ddl asc nulls last);
create index if not exists comments_time_idx  on public.comments (created_at desc);
create index if not exists activities_time_idx on public.activities (activity_at asc nulls last);

-- ---------------------------------------------------------------------
-- 2. updated_at 自动维护
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tasks_touch on public.tasks;
create trigger trg_tasks_touch before update on public.tasks
for each row execute function public.touch_updated_at();

drop trigger if exists trg_activities_touch on public.activities;
create trigger trg_activities_touch before update on public.activities
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. 作者判定（所有人权限相同）
-- ---------------------------------------------------------------------
-- 若你之前跑过「分模块权限」的旧版本，这里先把旧策略/旧函数清掉，避免冲突。
drop policy if exists tasks_write      on public.tasks;
drop policy if exists activities_write on public.activities;
drop policy if exists comments_read    on public.comments;
drop policy if exists comments_admin   on public.comments;
drop policy if exists comments_delete  on public.comments;
drop policy if exists config_write     on public.site_config;
drop policy if exists authors_read     on public.authors;
drop policy if exists authors_write    on public.authors;
drop function if exists public.is_admin();
drop function if exists public.my_caps();
drop function if exists public.can_write(text);
drop function if exists public.can_moderate();
drop function if exists public.is_owner();
alter table public.authors add column if not exists name text not null default '';
alter table public.authors drop column if exists is_owner;
alter table public.authors drop column if exists can_study;
alter table public.authors drop column if exists can_activity;
alter table public.authors drop column if exists can_moderate;

-- 当前登录者邮箱（统一小写）
create or replace function public.auth_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- 是不是作者（在 authors 名单里）
create or replace function public.is_author() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.authors where email = public.auth_email());
$$;

-- 前端据此显示 / 隐藏编辑按钮
create or replace function public.my_caps() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('email', public.auth_email(), 'author', public.is_author());
$$;

-- 兼容旧名字
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_author();
$$;

-- ---------------------------------------------------------------------
-- 4. 启用行级安全（RLS）—— 权限在数据库层强制执行
-- ---------------------------------------------------------------------
alter table public.tasks       enable row level security;
alter table public.comments    enable row level security;
alter table public.site_config enable row level security;
alter table public.activities  enable row level security;
alter table public.authors     enable row level security;

-- authors：作者之间互相可见（用于维护名单）
drop policy if exists authors_read on public.authors;
create policy authors_read on public.authors for select to authenticated
  using (public.is_author());

drop policy if exists authors_write on public.authors;
create policy authors_write on public.authors for all to authenticated
  using (public.is_author()) with check (public.is_author());

-- tasks：所有人可读；作者可写
drop policy if exists tasks_read  on public.tasks;
create policy tasks_read  on public.tasks for select using (true);

drop policy if exists tasks_write on public.tasks;
create policy tasks_write on public.tasks for all to authenticated
  using (public.is_author()) with check (public.is_author());

-- activities：所有人可读；作者可写
drop policy if exists activities_read on public.activities;
create policy activities_read on public.activities for select using (true);

drop policy if exists activities_write on public.activities;
create policy activities_write on public.activities for all to authenticated
  using (public.is_author()) with check (public.is_author());

-- comments：所有人可读「未被隐藏」的；任何人可插入；作者可改/删
drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments for select
  using (is_hidden = false or public.is_author());

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to anon, authenticated
  with check (is_hidden = false);

drop policy if exists comments_admin on public.comments;
create policy comments_admin on public.comments for update to authenticated
  using (public.is_author()) with check (public.is_author());

drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated
  using (public.is_author());

-- site_config：所有人可读；作者可写
drop policy if exists config_read on public.site_config;
create policy config_read  on public.site_config for select using (true);

drop policy if exists config_write on public.site_config;
create policy config_write on public.site_config for all to authenticated
  using (public.is_author()) with check (public.is_author());

-- ---------------------------------------------------------------------
-- 5. 表级权限（配合 RLS 使用）
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.tasks to anon, authenticated;
grant insert, update, delete on public.tasks to authenticated;

grant select on public.comments to anon, authenticated;
grant insert on public.comments to anon, authenticated;
grant update, delete on public.comments to authenticated;

grant select on public.site_config to anon, authenticated;
grant insert, update, delete on public.site_config to authenticated;

grant select on public.activities to anon, authenticated;
grant insert, update, delete on public.activities to authenticated;

grant select on public.authors to authenticated;
grant insert, update, delete on public.authors to authenticated;

-- ---------------------------------------------------------------------
-- 6. 站点基础配置（可在表里直接改）
-- ---------------------------------------------------------------------
insert into public.site_config (key, value) values
  ('class_name',   '"名不虚传播学班"'),
  ('title',        '"本学期学习任务"'),
  ('semester',     '"2026 春"'),
  ('announcement', '"任务由作者实时维护；任何人可浏览全部内容，并在下方发弹幕互动。"')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 7. 作者名单
-- ---------------------------------------------------------------------
-- ★★★ 改成你自己的登录邮箱 ★★★
insert into public.authors (email, name) values
  ('2314997838@qq.com', '作者（我）')
on conflict (email) do nothing;

-- 想邀请其他人（如学习委员）一起维护？把下面注释去掉、改成他的邮箱即可：
-- insert into public.authors (email, name) values
--   ('xuewei@example.com', '学习委员')
-- on conflict (email) do nothing;

-- ---------------------------------------------------------------------
-- 8. 实时推送（Realtime）：把表加入实时复制
--    失败也不影响使用（前端会自动退回轮询）；可重复执行。
-- ---------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.tasks;      exception when others then null; end;
  begin alter publication supabase_realtime add table public.activities; exception when others then null; end;
  begin alter publication supabase_realtime add table public.comments;   exception when others then null; end;
end $$;

-- =====================================================================
-- 完成。接下来：
--   ① 把 Project URL 与 anon public key 填进 src/config.js
--   ② 用第 7 节 authors 里的邮箱注册账号
--      （Supabase → Authentication → Users → Add user，设置邮箱+密码，
--       建议勾选 "Auto Confirm User"，否则要先点邮件确认）
--   ③ 打开网站，点「作者登录」即可增删改
--
-- 让别人（学习委员等）也能登录编辑：
--   ① Authentication → Users → Add user，用他的邮箱建账号
--   ② 在 authors 表里加一行（或取消上面示例的注释）
--   ③ 他打开网站 → 作者登录 → 用自己邮箱密码进入，即可编辑全部内容
-- =====================================================================
