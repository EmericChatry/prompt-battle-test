# Prompt Battle — Managers en santé — V2.2

Première version multijoueur connectée à Supabase.

## Ce que cette version teste

- authentification anonyme automatique ;
- création d'une session par le formateur ;
- code de session à 6 caractères ;
- inscription d'un participant dans l'une des 8 équipes ;
- équipes occupées visibles par les autres participants ;
- apparition en temps réel d'une équipe connectée dans l'espace formateur.

## Avant le test

Dans Supabase, ajouter les tables à la publication Realtime et empêcher un même utilisateur de réserver plusieurs équipes dans la même session (SQL fourni par ChatGPT lors de l'installation).

## Important

La sauvegarde des prompts, le chrono collectif de 5 min 30, la notation et la suppression réelle des sessions seront ajoutés dans les versions suivantes.
