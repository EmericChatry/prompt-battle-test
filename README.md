# Prompt Battle — Managers en santé — V2.4

V2.4 ajoute la partie formateur dédiée au débrief : consultation des productions, notation sur 4 critères, projection en grand, classement cumulé et publication du classement aux participants.

## Avant de publier la V2.4

Exécuter une seule fois le fichier `supabase-v2.4.sql` dans **Supabase > SQL Editor**.

## Nouveautés

- Consultation des productions par manche et par équipe.
- Notation formateur : Pertinence, Précision, Contexte, Utilité managériale, chacune sur 5.
- Total automatique sur 20 pour chaque manche.
- Autoévaluation visible à côté de la note formateur, mais non intégrée au classement.
- Mode « Afficher en grand » pour projeter prompt + réponse pendant le débrief.
- Classement cumulé en fonction des notes du formateur.
- Bouton Publier / Masquer : les participants n'accèdent au classement qu'après publication.
- Les évaluations formateur sont stockées dans une table séparée (`trainer_evaluations`).

## Déploiement test

Remplacer les fichiers du dépôt `prompt-battle-test` par ceux de ce dossier, puis tester avant de reporter la version vers le dépôt de production.
