# Prompt Battle Managers Santé — V2.7

Cette version corrige le pilotage anticipé des manches.

## Correctif principal

Le formateur peut désormais **clôturer une manche à tout moment**, même si le chrono est encore en cours ou en pause.

- Pendant une manche active, le bouton devient : **« ⏭ Clôturer la manche X et préparer la manche Y »**.
- Une confirmation précise que le chrono sera arrêté immédiatement.
- Après confirmation, tous les participants basculent sur la manche suivante en état **prêt / attente**, avec un chrono réinitialisé à **05:30**.
- La manche suivante ne démarre qu'au clic du formateur sur **« ▶ Lancer la manche »**.
- Pendant la manche 3, le bouton devient **« ⏹ Clôturer la manche 3 et terminer la battle »**.

Aucune migration SQL supplémentaire n'est nécessaire par rapport à la V2.6.
