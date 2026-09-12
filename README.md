# Prompt Battle — V2.8

Correctif de pilotage formateur.

- Le bouton « Clôturer la manche … et préparer la manche suivante » relit désormais l’état réel de la session dans Supabase avant d’agir.
- La transition arrête immédiatement le chrono, passe la session en attente et prépare la manche suivante à 05:30.
- La manche 3 peut être clôturée immédiatement pour terminer la battle.
- Les fichiers CSS/JS utilisent un numéro de version dans `index.html` afin d’éviter qu’un navigateur ou GitHub Pages conserve une ancienne version en cache.
- Aucun changement SQL n’est nécessaire.
