-- Prompt Battle V2.12 : paquets de scénarios
-- Appliqué le 2026-10-10 sur le projet Supabase partagé (test et production).
-- Additif : compatible avec la V2.11.0 (les sessions existantes prennent 'managers').

alter table public.sessions
  add column if not exists pack_id text not null default 'managers';

-- get_session_for_join renvoie désormais pack_id.
-- Le type de retour change : la fonction ne peut pas être remplacée en place.
-- Appliqué par renommage (l'ancienne version est conservée sous un autre nom) :
--   1. création de public.get_session_for_join_next (même corps + pack_id)
--   2. alter function public.get_session_for_join(text) rename to get_session_for_join_v211;
--   3. alter function public.get_session_for_join_next(text) rename to get_session_for_join;
-- Version finale de la fonction :
--
-- create function public.get_session_for_join(p_code text)
-- returns table(
--   id uuid, session_code text, current_round integer, status text,
--   round_started_at timestamp with time zone, round_duration_seconds integer,
--   ranking_published boolean, pack_id text
-- )
-- language sql security definer set search_path to 'public'
-- as $$
--   select s.id, s.session_code, s.current_round, s.status,
--          s.round_started_at, s.round_duration_seconds, s.ranking_published,
--          s.pack_id
--   from public.sessions s
--   where s.session_code = upper(p_code)
--   limit 1;
-- $$;
-- grant execute on function public.get_session_for_join(text) to anon, authenticated, service_role;

-- Nettoyage possible plus tard (l'ancienne version n'est plus utilisée) :
-- drop function public.get_session_for_join_v211(text);
