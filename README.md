# Prompt Battle V2.13.0

Jeu collaboratif pour apprendre à écrire de bons prompts (méthode RCTF : Rôle, Contexte, Tâche, Format), en formation en santé.

L'application est unique. Le contenu des 2 manches change selon la formation choisie par le formateur à la création de la session : c'est un paquet de scénarios.

## Fonctionnement

- Le formateur crée une session et choisit une formation (un paquet).
- Les participants rejoignent par le lien (idéal sur ordinateur), par QR code ou par code à 6 caractères, puis choisissent une équipe (10 emplacements).
- 2 manches de 15 minutes, chrono commun, pause et reprise, clôture anticipée.
- Chaque équipe dépose son premier prompt, son prompt final complet (celui qu'elle enverrait dans une nouvelle conversation) et coche ce qu'elle a amélioré entre les deux. Les réponses de l'IA ne sont plus déposées.
- Le formateur note le prompt en étoiles (4 critères de 1 à 5 : Rôle et contexte, Tâche, Format, Progression) et peut rédiger un retour par équipe (2 points forts, 2 axes). Un écran de synthèse montre ce que les équipes disent avoir amélioré.
- La publication du classement rend visibles le total de chaque équipe, et pour chaque équipe son propre détail par critère et ses retours.

## Paquets de scénarios

Un paquet est un fichier JSON dans `scenarios/`, déclaré dans `scenarios/index.json` (identifiant, titre, description, fichier).

Paquets actuels :

- `managers` : Managers en santé (« Le mail impossible », « La réunion d'équipe »).
- `formateur` : Formateurs en santé (« Le cours à sauver », « Le test à construire »).

Champs d'un scénario : `id`, `title`, `situation`, `mission`, `durationSeconds` (900 pour 15 minutes), `method` (Rôle, Contexte, Tâche, Format dans cet ordre), `grading` (échelle sur 20 et 4 critères). Facultatifs : `material` (encadré affiché aux équipes, avec `title` et `text`), `fictitiousCopies` et `referenceGrade` (réservés à une future manche de notation, non utilisés).

Principe d'écriture : une situation courte avec les faits à penser à transmettre à l'IA, une mission en une phrase. Le détail du bon prompt (longueur, structure, public) reste à la charge des équipes.

Le moteur vérifie chaque fichier au chargement (voir `packs.js`). En cas de problème, un bandeau d'erreur en français indique le fichier et le champ en cause, et aucune session n'est créée avec un paquet invalide.

Contraintes du moteur :

- exactement 2 scénarios par paquet ;
- les 4 critères gardent les clés `pertinence`, `precision`, `context_score`, `utility` (colonnes de `trainer_evaluations`), de 1 à 5. Depuis la V2.13, les libellés sont Rôle et contexte (`pertinence`), Tâche (`precision`), Format (`context_score`) et Progression (`utility`) ;
- seuls les libellés et les questions des critères peuvent changer d'un paquet à l'autre.

Pour ajouter une formation : créer `scenarios/mon-paquet.json`, puis l'ajouter à `scenarios/index.json`. Aucune modification de code ni de base de données n'est nécessaire.

## Base de données (Supabase)

Le projet Supabase est partagé entre le test et la production. Toute modification doit rester compatible avec la version en ligne.

- V2.12.0 : colonne `sessions.pack_id` (valeur par défaut `managers`) et fonction `get_session_for_join`, qui renvoie `pack_id`. Voir `supabase-v2.12.sql`. Une session sans `pack_id` est traitée comme `managers`.
- V2.13.0 : colonnes `submissions.first_prompt_text` et `submissions.changes_made`, contrainte `teams.team_slot` portée de 8 à 10, table `team_feedback` (retours écrits, lisibles par le formateur et par l'équipe concernée après publication). Voir `supabase-v2.13.sql` (appliqué le 22 octobre 2026).
- V2.13b : fonction `get_ranking_totals(session)`, qui renvoie uniquement (équipe, manche, total). Additive, sans effet sur la V2.12.0. Voir `supabase-v2.13b.sql`.
- V2.13c : verrou. La lecture de `trainer_evaluations` est limitée au formateur et à l'équipe concernée (après publication). **Incompatible avec la V2.12.0** : un participant de la V2.12.0 ne verrait plus que sa propre équipe dans le classement. À lancer seulement quand la V2.13 est en ligne partout où le formateur anime. Voir `supabase-v2.13c.sql`, qui contient aussi la règle d'origine pour revenir en arrière.

Le total de `trainer_evaluations` est une colonne calculée (somme des 4 critères). Les étoiles affichées sont ce total divisé par 4.

Visibilité des notes (une fois la V2.13c appliquée) : le classement montre à chaque participant le total de toutes les équipes (via `get_ranking_totals`). Le détail par critère et les commentaires ne sont lisibles que pour sa propre équipe. Le formateur voit tout, y compris le détail par critère de chaque équipe dans son classement. L'écran du classement participant se relit toutes les 20 secondes, car la base ne signale à un participant que les changements de sa propre équipe.

## Fichiers

- `index.html`, `style.css`, `script.js` : l'application.
- `packs.js` : chargement et validation des paquets.
- `scenarios/` : l'index et les paquets.
- `supabase-v2.4.sql`, `supabase-v2.12.sql`, `supabase-v2.13.sql`, `supabase-v2.13b.sql`, `supabase-v2.13c.sql` : migrations de référence.

## Reporté à une version ultérieure

Bouton « Analyser les prompts » côté formateur (IA appelée par une fonction Supabase, clé API jamais dans la page), notation à l'aveugle, historique des prompts par équipe, vote anonyme, passation courte en début de formation pour mesurer une vraie progression.
