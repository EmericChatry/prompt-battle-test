# Prompt Battle V2.12.0

Jeu collaboratif pour apprendre à écrire de bons prompts (méthode RCTF : Rôle, Contexte, Tâche, Format), en formation en santé.

L'application est unique. Le contenu des 2 manches change selon la formation choisie par le formateur à la création de la session : c'est un paquet de scénarios.

## Fonctionnement

- Le formateur crée une session et choisit une formation (un paquet).
- Les participants rejoignent par QR code ou par code à 6 caractères, puis choisissent une équipe.
- 2 manches de 12 minutes, chrono commun, pause et reprise, clôture anticipée.
- Les équipes déposent leur prompt et le résultat obtenu avec leur IA. Le formateur note sur 20 (4 critères de 1 à 5) et publie le classement.

## Paquets de scénarios

Un paquet est un fichier JSON dans `scenarios/`, déclaré dans `scenarios/index.json` (identifiant, titre, description, fichier).

Paquets actuels :

- `managers` : Managers en santé (« Le mail impossible », « Le briefing d'équipe »).
- `formateur` : Formateurs en santé (« Le cours à sauver », « L'évaluation à remettre à jour »).

Champs d'un scénario : `id`, `title`, `situation`, `mission`, `durationSeconds`, `method` (Rôle, Contexte, Tâche, Format dans cet ordre), `grading` (échelle sur 20 et 4 critères). Facultatifs : `material` (texte de support affiché aux équipes, avec `title` et `text`), `fictitiousCopies` et `referenceGrade` (réservés à une future manche de notation, non utilisés).

Le moteur vérifie chaque fichier au chargement (voir `packs.js`). En cas de problème, un bandeau d'erreur en français indique le fichier et le champ en cause, et aucune session n'est créée avec un paquet invalide.

Contraintes du moteur :

- exactement 2 scénarios par paquet ;
- les 4 critères gardent les clés `pertinence`, `precision`, `context_score`, `utility` (colonnes de `trainer_evaluations`), de 1 à 5, soit 20 points ;
- seuls les libellés et les questions des critères peuvent changer d'un paquet à l'autre.

Pour ajouter une formation : créer `scenarios/mon-paquet.json`, puis l'ajouter à `scenarios/index.json`. Aucune modification de code ni de base de données n'est nécessaire.

## Base de données (Supabase)

Le projet Supabase est partagé entre le test et la production. Toute modification doit rester compatible avec la version en ligne.

La V2.12.0 utilise la colonne `sessions.pack_id` (valeur par défaut `managers`) et la fonction `get_session_for_join`, qui renvoie `pack_id`. Voir `supabase-v2.12.sql`. Une session sans `pack_id` est traitée comme `managers`.

## Fichiers

- `index.html`, `style.css`, `script.js` : l'application.
- `packs.js` : chargement et validation des paquets.
- `scenarios/` : l'index et les paquets.
- `supabase-v2.4.sql`, `supabase-v2.12.sql` : migrations de référence.

## Reporté à une version ultérieure

Notation à l'aveugle, historique des prompts par équipe, vote anonyme.
