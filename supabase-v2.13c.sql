-- Prompt Battle V2.13c : verrou. Le détail par critère n'est lisible que par le formateur et par l'équipe concernée.
-- À lancer APRÈS supabase-v2.13b.sql, et seulement quand la V2.13 est en ligne partout où tu animes.
--
-- ATTENTION, cette règle n'est pas compatible avec la V2.12.0 : la V2.12.0 lit toutes les notes de la session
-- pour construire le classement. Une fois ce fichier lancé, un participant de la V2.12.0 ne verrait plus
-- que les notes de sa propre équipe dans le classement.
--
-- Pour revenir en arrière, relancer la règle d'origine (reprise en bas de ce fichier).
alter policy trainer_evaluations_read on public.trainer_evaluations
  using (
    exists (select 1 from public.sessions s
            where s.id = trainer_evaluations.session_id and s.created_by = auth.uid())
    or (
      exists (select 1 from public.teams t
              where t.id = trainer_evaluations.team_id and t.owner_user_id = auth.uid())
      and exists (select 1 from public.sessions s
                  where s.id = trainer_evaluations.session_id and s.ranking_published = true)
    )
  );

-- Règle d'origine (V2.12.0), pour revenir en arrière :
-- alter policy trainer_evaluations_read on public.trainer_evaluations
--   using (
--     exists (select 1 from public.sessions s
--             where s.id = trainer_evaluations.session_id
--               and (s.created_by = auth.uid() or s.ranking_published = true))
--   );
