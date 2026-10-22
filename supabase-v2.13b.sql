-- Prompt Battle V2.13b : le total de chaque équipe reste visible dans le classement, le détail par critère non.
-- À lancer dans le SQL Editor de Supabase, AVANT le fichier supabase-v2.13c.sql.
--
-- Additif : ne change aucune règle existante, donc sans effet sur la V2.12.0 en ligne.
-- La fonction renvoie uniquement (équipe, manche, total). Jamais le détail par critère.
--   - le formateur de la session reçoit tous les totaux ;
--   - un participant (propriétaire d'une équipe de la session) les reçoit seulement une fois le classement publié ;
--   - toute autre personne reçoit une liste vide.
create or replace function public.get_ranking_totals(p_session_id uuid)
returns table (team_id uuid, round_number integer, total integer)
language sql
stable
security definer
set search_path = public
as $$
  select e.team_id, e.round_number, e.total
  from public.trainer_evaluations e
  join public.sessions s on s.id = e.session_id
  where e.session_id = p_session_id
    and (
      s.created_by = auth.uid()
      or (
        s.ranking_published = true
        and exists (select 1 from public.teams t
                    where t.session_id = s.id and t.owner_user_id = auth.uid())
      )
    );
$$;

revoke all on function public.get_ranking_totals(uuid) from public, anon;
grant execute on function public.get_ranking_totals(uuid) to authenticated;
