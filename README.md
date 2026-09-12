# Prompt Battle — Managers en santé — V2.5

V2.5 finalise le parcours de fin de battle et la publication des résultats sur les téléphones des participants.

## Aucune nouvelle migration Supabase

Si la migration V2.4 (`supabase-v2.4.sql`) a déjà été exécutée avec succès, il n'y a **aucun SQL supplémentaire** à lancer pour cette version.

## Finitions V2.5

- Bouton formateur explicite : **Publier le classement aux participants** / **Masquer le classement aux participants**.
- Badge **Privé / Publié** dans le tableau de bord formateur.
- Confirmation avant publication d'un classement provisoire ou incomplet.
- À la fin de la 3e manche, les participants arrivent sur un écran d'attente dédié.
- Dès que le formateur publie le classement final, celui-ci s'ouvre automatiquement sur les téléphones connectés.
- Un bandeau flottant permet de rouvrir le classement à tout moment après publication.
- Classement mobile avec podium, classement complet et mise en évidence de l'équipe du participant.
- Score final affiché sur **60 points** lorsque les trois manches sont notées.
- Le classement reste actualisable en temps réel tant qu'il est publié.

## Workflow conseillé en formation

1. Terminer la manche 3.
2. Cliquer sur **Terminer la Prompt Battle** côté formateur.
3. Les participants voient un écran « Classement en attente ».
4. Terminer les évaluations des productions.
5. Cliquer sur **Publier le classement aux participants**.
6. Le classement s'affiche automatiquement sur les téléphones.
7. Utiliser ensuite le mode projection pour le débrief collectif.

## Déploiement

Remplacer les fichiers du dépôt `prompt-battle-test` par ceux de ce dossier. Après validation, reporter cette version dans le dépôt de production.
