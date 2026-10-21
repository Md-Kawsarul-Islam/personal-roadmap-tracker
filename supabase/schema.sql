-- Run this in Supabase Dashboard → SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track text not null check (track in ('IELTS','Full Stack','Thesis','Routine')),
  title text not null check (char_length(title) between 1 and 500),
  description text not null default '',
  due_date date not null default current_date,
  day_number integer,
  is_completed boolean not null default false,
  completed_at timestamptz,
  estimated_minutes integer not null default 25 check (estimated_minutes between 1 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_user_due_date_idx on public.tasks(user_id, due_date);
create index if not exists tasks_user_track_idx on public.tasks(user_id, track);

alter table public.tasks enable row level security;
drop policy if exists "Users can view their own tasks" on public.tasks;
drop policy if exists "Users can create their own tasks" on public.tasks;
drop policy if exists "Users can update their own tasks" on public.tasks;
drop policy if exists "Users can delete their own tasks" on public.tasks;
create policy "Users can view their own tasks" on public.tasks for select using (auth.uid() = user_id);
create policy "Users can create their own tasks" on public.tasks for insert with check (auth.uid() = user_id);
create policy "Users can update their own tasks" on public.tasks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own tasks" on public.tasks for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
