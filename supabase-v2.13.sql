-- Prompt Battle V2.13 : premier prompt, prompt complet, améliorations cochées, retours aux équipes, 10 équipes.
-- NON APPLIQUÉ : à montrer au formateur, puis à lancer dans le SQL Editor de Supabase.
--
-- Additif : compatible avec la V2.12.0 en ligne (qui n'utilise ni ces colonnes, ni cette table,
-- ni les emplacements 9 et 10). Les colonnes ajoutées ont une valeur par défaut, donc les insertions
-- de l'ancienne version continuent de fonctionner.

-- 1. Soumissions : le prompt final complet reste dans prompt_text.
--    first_prompt_text = premier prompt de l'équipe ; changes_made = cases cochées
--    (role, context, task, format, constraint, other).
--    ai_response_text et prompt_count ne sont plus renseignés par la V2.13 (ils restent nullables).
alter table public.submissions
  add column if not exists first_prompt_text text,
  add column if not exists changes_made text[] not null default '{}';

-- 2. Équipes : de 8 à 10 emplacements.
alter table public.teams drop constraint if exists teams_team_slot_check;
alter table public.teams
  add constraint teams_team_slot_check check (team_slot >= 1 and team_slot <= 10);

-- 3. Retours écrits du formateur (2 points forts, 2 axes), par équipe et par manche.
--    Table à part des notes : les notes servent au classement public, mais un retour ne doit être lisible
--    que par le formateur de la session et par l'équipe concernée, et seulement après la publication.
create table if not exists public.team_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  round_number integer not null check (round_number >= 1 and round_number <= 3),
  strengths text[] not null default '{}',
  axes text[] not null default '{}',
  written_by uuid,
  updated_at timestamp with time zone not null default now(),
  unique (session_id, team_id, round_number)
);

alter table public.team_feedback enable row level security;

grant select, insert, update, delete on public.team_feedback to authenticated;
revoke all on public.team_feedback from anon;

-- Lecture : le formateur de la session, ou le propriétaire de l'équipe une fois le classement publié.
create policy team_feedback_read on public.team_feedback
  for select to authenticated
  using (
    exists (select 1 from public.sessions s
            where s.id = team_feedback.session_id and s.created_by = auth.uid())
    or (
      exists (select 1 from public.teams t
              where t.id = team_feedback.team_id and t.owner_user_id = auth.uid())
      and exists (select 1 from public.sessions s
                  where s.id = team_feedback.session_id and s.ranking_published = true)
    )
  );

-- Écriture : le formateur de la session uniquement.
create policy team_feedback_insert on public.team_feedback
  for insert to authenticated
  with check (exists (select 1 from public.sessions s
                      where s.id = team_feedback.session_id and s.created_by = auth.uid()));

create policy team_feedback_update on public.team_feedback
  for update to authenticated
  using (exists (select 1 from public.sessions s
                 where s.id = team_feedback.session_id and s.created_by = auth.uid()))
  with check (exists (select 1 from public.sessions s
                      where s.id = team_feedback.session_id and s.created_by = auth.uid()));

create policy team_feedback_delete on public.team_feedback
  for delete to authenticated
  using (exists (select 1 from public.sessions s
                 where s.id = team_feedback.session_id and s.created_by = auth.uid()));

-- Vérifié à blanc le 2026-10-21 (transaction annulée, vrais comptes) pour la table et ses règles :
--   le formateur lit tout ; une équipe ne lit rien avant la publication, puis seulement sa propre ligne ;
--   une équipe ne peut ni écrire ni modifier ; un tiers sans équipe ne lit rien.
