-- Prompt Battle V2.13 : premier prompt, prompt complet, améliorations cochées, retours aux équipes, 10 équipes.
-- NON APPLIQUÉ : à montrer au formateur, puis à lancer dans le SQL Editor de Supabase.
--
-- Additif : compatible avec la V2.12.0 en ligne (qui n'utilise ni ces colonnes ni les emplacements 9 et 10).
-- Les colonnes ajoutées ont une valeur par défaut, donc les insertions de l'ancienne version continuent de fonctionner.

-- 1. Soumissions : le prompt final complet reste dans prompt_text.
--    first_prompt_text = premier prompt de l'équipe ; changes_made = cases cochées
--    (role, context, task, format, constraint, other).
--    ai_response_text et prompt_count ne sont plus renseignés par la V2.13 (ils restent nullables).
alter table public.submissions
  add column if not exists first_prompt_text text,
  add column if not exists changes_made text[] not null default '{}';

-- 2. Évaluations : retour écrit par le formateur pour chaque équipe et chaque manche.
--    Lisible par les participants dès que le classement est publié (même règle de lecture que les notes).
alter table public.trainer_evaluations
  add column if not exists feedback_strengths text[] not null default '{}',
  add column if not exists feedback_axes text[] not null default '{}';

-- 3. Équipes : de 8 à 10 emplacements.
alter table public.teams drop constraint if exists teams_team_slot_check;
alter table public.teams
  add constraint teams_team_slot_check check (team_slot >= 1 and team_slot <= 10);
