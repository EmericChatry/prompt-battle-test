-- Prompt Battle V2.4 — notation formateur + classement publié

-- 1) Le formateur peut publier/masquer le classement.
alter table public.sessions
add column if not exists ranking_published boolean not null default false;

-- 2) Les évaluations formateur sont séparées des soumissions participantes.
--    Cela évite qu'un participant puisse modifier sa note formateur.
create table if not exists public.trainer_evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 3),
  pertinence integer not null check (pertinence between 1 and 5),
  precision integer not null check (precision between 1 and 5),
  context_score integer not null check (context_score between 1 and 5),
  utility integer not null check (utility between 1 and 5),
  total integer generated always as (pertinence + precision + context_score + utility) stored,
  evaluated_by uuid references auth.users(id),
  evaluated_at timestamptz not null default now(),
  unique (session_id, team_id, round_number)
);

create index if not exists idx_trainer_evaluations_session
on public.trainer_evaluations(session_id);

create index if not exists idx_trainer_evaluations_team
on public.trainer_evaluations(team_id);

alter table public.trainer_evaluations enable row level security;

-- Relançable sans créer de doublons de policies.
drop policy if exists "trainer_evaluations_read" on public.trainer_evaluations;
drop policy if exists "trainer_evaluations_insert" on public.trainer_evaluations;
drop policy if exists "trainer_evaluations_update" on public.trainer_evaluations;
drop policy if exists "trainer_evaluations_delete" on public.trainer_evaluations;

-- Le propriétaire de la session voit toujours les notes.
-- Les participants ne les voient que lorsque le classement est publié.
create policy "trainer_evaluations_read"
on public.trainer_evaluations
for select
to authenticated
using (
  exists (
    select 1
    from public.sessions s
    where s.id = trainer_evaluations.session_id
      and (
        s.created_by = auth.uid()
        or s.ranking_published = true
      )
  )
);

create policy "trainer_evaluations_insert"
on public.trainer_evaluations
for insert
to authenticated
with check (
  evaluated_by = auth.uid()
  and exists (
    select 1
    from public.sessions s
    where s.id = trainer_evaluations.session_id
      and s.created_by = auth.uid()
  )
);

create policy "trainer_evaluations_update"
on public.trainer_evaluations
for update
to authenticated
using (
  exists (
    select 1
    from public.sessions s
    where s.id = trainer_evaluations.session_id
      and s.created_by = auth.uid()
  )
)
with check (
  evaluated_by = auth.uid()
  and exists (
    select 1
    from public.sessions s
    where s.id = trainer_evaluations.session_id
      and s.created_by = auth.uid()
  )
);

create policy "trainer_evaluations_delete"
on public.trainer_evaluations
for delete
to authenticated
using (
  exists (
    select 1
    from public.sessions s
    where s.id = trainer_evaluations.session_id
      and s.created_by = auth.uid()
  )
);

-- 3) Temps réel pour les notes/classement.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trainer_evaluations'
  ) then
    alter publication supabase_realtime add table public.trainer_evaluations;
  end if;
end $$;
