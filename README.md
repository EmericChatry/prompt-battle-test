# Prompt Battle Managers en santé — V2.6

Correctif de synchronisation de fin de battle et de publication du classement.

## Changements principaux

- Dès que le formateur termine la battle, un participant déjà engagé dans une équipe est forcé vers un écran d’attente, même s’il se trouve encore sur l’auto-évaluation.
- Dès que le classement est publié, le téléphone ouvre automatiquement le classement.
- Le temps réel Supabase reste prioritaire, avec un contrôle de synchronisation toutes les 3 secondes uniquement pendant la fin de battle / publication pour résister aux mises en veille des téléphones.
- Une resynchronisation est aussi effectuée lorsque le participant revient sur l’onglet ou remet le navigateur au premier plan.
- Un bouton « Actualiser l’état » reste disponible sur l’écran d’attente comme solution de secours.
- Aucun changement SQL n’est nécessaire par rapport à la V2.4/V2.5.

## Test recommandé

1. Rejoindre une session depuis un téléphone et terminer la manche 3.
2. Rester volontairement sur l’écran d’auto-évaluation.
3. Côté formateur, terminer la Prompt Battle.
4. Vérifier que le téléphone bascule automatiquement sur l’écran « Battle terminée ».
5. Côté formateur, publier le classement.
6. Vérifier que le téléphone ouvre automatiquement le classement, sans retour manuel à l’accueil.
