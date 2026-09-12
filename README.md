# Prompt Battle — V2.10.1

Correctif ciblé de fiabilité du pilotage formateur, sans changement fonctionnel pour les participants.

## Correction principale

- Le bouton de passage à la manche suivante relit systématiquement l’état réel de la session dans Supabase avant la transition.
- L’interface formateur se resynchronise automatiquement avec la session toutes les 2 secondes lorsqu’elle est visible.
- Une resynchronisation est aussi déclenchée quand l’onglet redevient visible ou reprend le focus.
- Une transition de manche ne peut plus être lancée deux fois en parallèle.
- Après l’écriture dans Supabase, l’application vérifie explicitement que la nouvelle manche a bien été enregistrée.
- Le bouton retrouve toujours un état utilisable après succès, annulation ou erreur.
- Le cache JavaScript est invalidé avec la version `2.10.1`.

## Fonctionnalités conservées

- QR code de session avec ouverture directe de la bonne session.
- 3 manches avec chrono commun de 5 min 30.
- Pause/reprise et clôture anticipée.
- Soumissions, autoévaluation et notation formateur.
- Écran d’attente final et publication du classement sur les téléphones.

Aucune migration Supabase supplémentaire n’est nécessaire.
