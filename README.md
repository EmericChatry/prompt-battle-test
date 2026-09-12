# Prompt Battle — Managers en santé — V2.3

Version collaborative de test.

## Nouveautés
- chrono commun 5 min 30 piloté par le formateur ;
- lancement / pause / reprise synchronisés ;
- passage à la manche suivante piloté par le formateur ;
- soumission du prompt et du résultat dans Supabase ;
- autoévaluation enregistrée ;
- statut de soumission visible côté formateur ;
- soumissions hors délai acceptées et signalées ;
- réinitialisation réelle d'une session (équipes + productions) en conservant le même code.

## Migration Supabase requise
Exécuter une fois :

```sql
alter table public.sessions drop constraint if exists sessions_status_check;
alter table public.sessions
add constraint sessions_status_check
check (status in ('waiting', 'running', 'paused', 'review', 'finished'));
```

Puis remplacer les 4 fichiers du dépôt de test par cette V2.3.
